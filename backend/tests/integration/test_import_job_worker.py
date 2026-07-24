from __future__ import annotations

import threading
import time
import hashlib
import json
from uuid import UUID

import pytest

from app.models.import_job import ImportJob
from app.schemas.dicom_import import ImportCategory, ImportItem, ImportReport
from app.schemas.import_job import ImportJobCreate
from app.services import import_job_worker as worker_module
from app.services.import_job_service import (
    create_job,
    mark_job_running,
    queue_job,
    record_confirmed_offset,
    requeue_running_jobs,
)
from app.services.import_job_worker import ImportJobWorker, recover_import_jobs
from fastapi.testclient import TestClient
from app.main import create_app
from tests.dicom_factory import write_dicom_file


def _payload(name: str = 'image.dcm') -> ImportJobCreate:
    return ImportJobCreate(
        files=[
            {
                'relative_path': name,
                'size_bytes': 4,
                'last_modified_ms': 1,
                'resume_fingerprint': '0' * 64,
            }
        ]
    )


def _report() -> ImportReport:
    return ImportReport(
        total=1,
        success=1,
        duplicate=0,
        skipped=0,
        unsupported=0,
        failed=0,
        items=[
            ImportItem(
                file_name='image.dcm',
                category=ImportCategory.SUCCESS,
                code='imported',
                message='CT DICOM 已保存',
            )
        ],
    )


def _fingerprint(relative_path: str, content: bytes, last_modified_ms: int = 1) -> str:
    metadata = json.dumps(
        {
            "relative_path": relative_path,
            "size": len(content),
            "last_modified_ms": last_modified_ms,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(metadata + content).hexdigest()


def _wait_for_status(session_factory, job_id, expected: str) -> ImportJob:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with session_factory() as session:
            job = session.get(ImportJob, job_id)
            if job is not None and job.status == expected:
                return job
        time.sleep(0.02)
    raise AssertionError(f'job did not reach {expected}')


def _create_queued_job(session, patient_id, import_storage):
    job_response = create_job(session, patient_id, _payload())
    import_storage.ensure_job_dir(job_response.id)
    path = import_storage.file_path(job_response.id, 0)
    path.write_bytes(b'data')
    record_confirmed_offset(
        session,
        job_response.id,
        job_response.files[0].id,
        0,
        4,
    )
    queue_job(session, job_response.id)
    return job_response.id


def test_worker_claims_serially_imports_and_cleans_terminal_staging(
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.patient import Patient

    with session_factory() as session:
        patient = Patient(
            medical_record_no='MR-WORKER-1',
            medical_record_no_normalized='mr-worker-1',
            name='Worker Patient',
            sex='unknown',
        )
        session.add(patient)
        session.commit()
        patient_id = patient.id

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    with session_factory() as session:
        job_id = _create_queued_job(session, patient_id, import_storage)

    called = threading.Event()

    def fake_import(session, patient_id, sources, storage):
        assert len(sources) == 1
        assert sources[0].display_name == 'image.dcm'
        called.set()
        return _report()

    monkeypatch.setattr(worker_module, 'import_dicom_files', fake_import)
    wakeup = threading.Event()
    worker = ImportJobWorker(
        session_factory,
        import_storage,
        managed_storage,
        wakeup,
    )
    worker.start()
    wakeup.set()
    try:
        completed = _wait_for_status(session_factory, job_id, 'completed')
        assert called.is_set()
        assert completed.report is not None
        staging = import_storage.import_jobs_dir / str(job_id)
        deadline = time.monotonic() + 5
        while staging.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert not staging.exists()
    finally:
        worker.stop()


def test_worker_never_processes_two_jobs_in_parallel(
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.patient import Patient

    with session_factory() as session:
        patients = [
            Patient(
                medical_record_no=f"MR-WORKER-SERIAL-{index}",
                medical_record_no_normalized=f"mr-worker-serial-{index}",
                name=f"Worker Patient {index}",
                sex="unknown",
            )
            for index in (1, 2)
        ]
        session.add_all(patients)
        session.commit()
        patient_ids = [patient.id for patient in patients]

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    with session_factory() as session:
        job_ids = [
            _create_queued_job(session, patient_id, import_storage)
            for patient_id in patient_ids
        ]

    started = threading.Event()
    release = threading.Event()
    active = 0
    max_active = 0
    lock = threading.Lock()

    def fake_import(session, patient_id, sources, storage):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        started.set()
        assert release.wait(timeout=5)
        with lock:
            active -= 1
        return _report()

    monkeypatch.setattr(worker_module, "import_dicom_files", fake_import)
    wakeup = threading.Event()
    worker = ImportJobWorker(
        session_factory,
        import_storage,
        managed_storage,
        wakeup,
    )
    worker.start()
    wakeup.set()
    try:
        assert started.wait(timeout=5)
        time.sleep(0.1)
        with session_factory() as session:
            statuses = [session.get(ImportJob, job_id).status for job_id in job_ids]
        assert statuses.count("running") == 1
        assert statuses.count("queued") == 1
        assert max_active == 1

        release.set()
        for job_id in job_ids:
            _wait_for_status(session_factory, job_id, "completed")
        assert max_active == 1
    finally:
        release.set()
        worker.stop()


def test_worker_stop_waits_for_active_import_to_finish(
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.patient import Patient

    with session_factory() as session:
        patient = Patient(
            medical_record_no="MR-WORKER-STOP",
            medical_record_no_normalized="mr-worker-stop",
            name="Worker Stop Patient",
            sex="unknown",
        )
        session.add(patient)
        session.commit()
        patient_id = patient.id

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    with session_factory() as session:
        job_id = _create_queued_job(session, patient_id, import_storage)

    started = threading.Event()
    release = threading.Event()
    stopped = threading.Event()

    def blocking_import(*_args, **_kwargs):
        started.set()
        assert release.wait(timeout=5)
        return _report()

    monkeypatch.setattr(worker_module, "import_dicom_files", blocking_import)
    worker = ImportJobWorker(
        session_factory,
        import_storage,
        managed_storage,
        threading.Event(),
    )
    worker.start()
    try:
        assert started.wait(timeout=5)
        stopper = threading.Thread(
            target=lambda: (worker.stop(), stopped.set()),
            daemon=True,
        )
        stopper.start()
        assert not stopped.wait(timeout=0.1)
        assert worker.is_alive

        release.set()
        assert stopped.wait(timeout=5)
        stopper.join(timeout=5)
        assert not worker.is_alive
        _wait_for_status(session_factory, job_id, "completed")
    finally:
        release.set()
        if worker.is_alive:
            worker.stop()


def test_worker_failure_is_persisted_and_running_jobs_requeue(
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.models.patient import Patient

    with session_factory() as session:
        patient = Patient(
            medical_record_no='MR-WORKER-2',
            medical_record_no_normalized='mr-worker-2',
            name='Worker Patient',
            sex='unknown',
        )
        session.add(patient)
        session.commit()
        patient_id = patient.id

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    with session_factory() as session:
        job_id = _create_queued_job(session, patient_id, import_storage)
        mark_job_running(session, job_id)
        assert requeue_running_jobs(session) == 1
        assert session.get(ImportJob, job_id).status == 'queued'

    def fail_import(*_args, **_kwargs):
        raise RuntimeError('private parser detail')

    monkeypatch.setattr(worker_module, 'import_dicom_files', fail_import)
    wakeup = threading.Event()
    worker = ImportJobWorker(
        session_factory,
        import_storage,
        managed_storage,
        wakeup,
    )
    worker.start()
    wakeup.set()
    try:
        failed = _wait_for_status(session_factory, job_id, 'failed')
        assert failed.error_code == 'import_failed'
        assert failed.error_message == '后台导入失败，请删除任务后重试'
    finally:
        worker.stop()


def test_startup_recovery_requeues_running_and_removes_unknown_orphans(
    session_factory,
    managed_storage,
) -> None:
    from app.models.patient import Patient

    with session_factory() as session:
        patient = Patient(
            medical_record_no='MR-WORKER-3',
            medical_record_no_normalized='mr-worker-3',
            name='Worker Patient',
            sex='unknown',
        )
        session.add(patient)
        session.commit()
        patient_id = patient.id

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    with session_factory() as session:
        job_id = _create_queued_job(session, patient_id, import_storage)
        mark_job_running(session, job_id)
    orphan = import_storage.import_jobs_dir / '11111111-1111-4111-8111-111111111111'
    orphan.mkdir(parents=True)
    recover_import_jobs(session_factory, import_storage)
    with session_factory() as session:
        assert session.get(ImportJob, job_id).status == 'queued'
    assert not orphan.exists()


def test_two_application_lifespans_preserve_offset_requeue_running_duplicate_and_cleanup(
    tmp_path,
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_fixture = write_dicom_file(
        tmp_path / "first" / "partial.dcm",
        patient_id="MR-LIFESPAN-A",
    )
    second_fixture = write_dicom_file(
        tmp_path / "second" / "complete.dcm",
        patient_id="MR-LIFESPAN-B",
    )
    first_bytes = first_fixture.path.read_bytes()
    second_bytes = second_fixture.path.read_bytes()

    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )
    monkeypatch.setattr(ImportJobWorker, "start", lambda self: None)
    with TestClient(application) as first_client:
        first_patient = first_client.post(
            "/api/patients",
            json={"medical_record_no": "MR-LIFESPAN-A", "name": "First"},
        ).json()
        second_patient = first_client.post(
            "/api/patients",
            json={"medical_record_no": "MR-LIFESPAN-B", "name": "Second"},
        ).json()
        partial_job = first_client.post(
            f"/api/patients/{first_patient['id']}/import-jobs",
            json={
                "files": [
                    {
                        "relative_path": "partial.dcm",
                        "size_bytes": len(first_bytes),
                        "last_modified_ms": 1,
                        "resume_fingerprint": _fingerprint(
                            "partial.dcm", first_bytes
                        ),
                    }
                ]
            },
        ).json()
        partial_file = partial_job["files"][0]
        half = len(first_bytes) // 2
        partial_upload = first_client.put(
            f"/api/import-jobs/{partial_job['id']}/files/{partial_file['id']}/content",
            headers={
                "Content-Type": "application/octet-stream",
                "Upload-Offset": "0",
            },
            content=first_bytes[:half],
        )
        assert partial_upload.status_code == 200
        assert partial_upload.json()["confirmed_offset"] == half

        running_job = first_client.post(
            f"/api/patients/{second_patient['id']}/import-jobs",
            json={
                "files": [
                    {
                        "relative_path": "complete.dcm",
                        "size_bytes": len(second_bytes),
                        "last_modified_ms": 1,
                        "resume_fingerprint": _fingerprint(
                            "complete.dcm", second_bytes
                        ),
                    }
                ]
            },
        ).json()
        running_file = running_job["files"][0]
        uploaded = first_client.put(
            f"/api/import-jobs/{running_job['id']}/files/{running_file['id']}/content",
            headers={
                "Content-Type": "application/octet-stream",
                "Upload-Offset": "0",
            },
            content=second_bytes,
        )
        assert uploaded.status_code == 200
        assert first_client.post(
            f"/api/import-jobs/{running_job['id']}/queue"
        ).status_code == 202

    monkeypatch.undo()
    with session_factory() as session:
        mark_job_running(session, UUID(running_job["id"]))

    restarted = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )
    with TestClient(restarted) as second_client:
        restored = second_client.get(
            f"/api/import-jobs/{partial_job['id']}"
        )
        assert restored.status_code == 200
        assert restored.json()["files"][0]["confirmed_offset"] == half

        completed = _wait_for_status(
            session_factory,
            UUID(running_job["id"]),
            "completed",
        )
        assert completed.report is not None
        assert completed.report["success"] == 1

        duplicate_job = second_client.post(
            f"/api/patients/{second_patient['id']}/import-jobs",
            json={
                "files": [
                    {
                        "relative_path": "duplicate.dcm",
                        "size_bytes": len(second_bytes),
                        "last_modified_ms": 1,
                        "resume_fingerprint": _fingerprint(
                            "duplicate.dcm", second_bytes
                        ),
                    }
                ]
            },
        ).json()
        duplicate_file = duplicate_job["files"][0]
        assert second_client.put(
            f"/api/import-jobs/{duplicate_job['id']}/files/{duplicate_file['id']}/content",
            headers={
                "Content-Type": "application/octet-stream",
                "Upload-Offset": "0",
            },
            content=second_bytes,
        ).status_code == 200
        assert second_client.post(
            f"/api/import-jobs/{duplicate_job['id']}/queue"
        ).status_code == 202
        duplicate = _wait_for_status(
            session_factory,
            UUID(duplicate_job["id"]),
            "completed",
        )
        assert duplicate.report is not None
        assert duplicate.report["duplicate"] == 1

        assert second_client.delete(
            f"/api/import-jobs/{partial_job['id']}"
        ).status_code == 204

    import_storage = worker_module.ImportJobStorage(managed_storage.settings)
    assert not import_storage.import_jobs_dir.exists() or not any(
        import_storage.import_jobs_dir.iterdir()
    )
