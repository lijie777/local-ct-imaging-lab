from __future__ import annotations

from datetime import timezone
from typing import Any
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import (
    ImportFileMismatchError,
    ImportInProgressError,
    ImportJobConflictError,
    ImportJobNotFoundError,
    ImportJobStateConflictError,
    ImportLimitExceededError,
    ImportOffsetConflictError,
    PersistenceError,
    PatientNotFoundError,
)
from app.models.import_job import ImportJob, ImportJobFile
from app.models.patient import Patient
from app.schemas.dicom_import import ImportCategory, ImportItem, ImportReport
from app.schemas.import_job import ImportJobCreate, ImportManifestFile
from app.services.import_job_service import (
    complete_job,
    create_job,
    delete_job,
    fail_job,
    get_job,
    get_latest_job,
    mark_job_running,
    queue_job,
    record_confirmed_offset,
)


MIB = 1024 * 1024


def _patient(db_session: Session, suffix: str = "1") -> Patient:
    patient = Patient(
        medical_record_no=f"MR-IMPORT-SERVICE-{suffix}",
        medical_record_no_normalized=f"mr-import-service-{suffix}",
        name="导入任务服务测试病人",
        sex="unknown",
    )
    db_session.add(patient)
    db_session.commit()
    return patient


def _manifest_file(
    relative_path: str = "study/image-001.dcm",
    *,
    size_bytes: int = 10,
    last_modified_ms: int = 1_784_800_000_000,
    resume_fingerprint: str = "a" * 64,
) -> ImportManifestFile:
    return ImportManifestFile(
        relative_path=relative_path,
        size_bytes=size_bytes,
        last_modified_ms=last_modified_ms,
        resume_fingerprint=resume_fingerprint,
    )


def _payload(*files: ImportManifestFile) -> ImportJobCreate:
    return ImportJobCreate(files=list(files) or [_manifest_file()])


def _create_job(
    db_session: Session,
    patient: Patient,
    *files: ImportManifestFile,
):
    return create_job(db_session, patient.id, _payload(*files))


def _complete_report(*, failed: bool = False) -> ImportReport:
    category = ImportCategory.FAILED if failed else ImportCategory.SUCCESS
    return ImportReport(
        total=1,
        success=0 if failed else 1,
        duplicate=0,
        skipped=0,
        unsupported=0,
        failed=1 if failed else 0,
        items=[
            ImportItem(
                file_name="image-001.dcm",
                category=category,
                code="invalid_dicom" if failed else "imported",
                message="文件不是有效 DICOM" if failed else "导入成功",
            )
        ],
    )


@pytest.mark.parametrize(
    "files",
    [
        [],
        [_manifest_file(relative_path=f"{index}.dcm") for index in range(2_001)],
    ],
)
def test_import_job_create_schema_rejects_invalid_file_count(
    files: list[ImportManifestFile],
) -> None:
    with pytest.raises(ValidationError):
        ImportJobCreate(files=files)


def test_import_manifest_schema_is_strict_and_validates_file_fields() -> None:
    with pytest.raises(ValidationError):
        ImportManifestFile(
            relative_path="image.dcm",
            size_bytes=512 * MIB + 1,
            last_modified_ms=0,
            resume_fingerprint="a" * 64,
        )
    with pytest.raises(ValidationError):
        ImportManifestFile(
            relative_path="image.dcm",
            size_bytes=1,
            last_modified_ms=0,
            resume_fingerprint="A" * 64,
        )
    with pytest.raises(ValidationError):
        ImportManifestFile(
            relative_path="image.dcm",
            size_bytes=1,
            last_modified_ms=0,
            resume_fingerprint="a" * 64,
            unexpected=True,
        )


def test_create_job_rechecks_file_count_when_schema_validation_is_bypassed(
    db_session: Session,
) -> None:
    patient = _patient(db_session)
    payload = ImportJobCreate.model_construct(files=[])

    with pytest.raises(ImportLimitExceededError):
        create_job(db_session, patient.id, payload)

    assert db_session.scalar(select(ImportJob)) is None


def test_create_job_rejects_total_over_eight_gibibytes(
    db_session: Session,
) -> None:
    patient = _patient(db_session)
    files = [
        _manifest_file(f"{index}.dcm", size_bytes=512 * MIB)
        for index in range(17)
    ]

    with pytest.raises(ImportLimitExceededError):
        create_job(db_session, patient.id, ImportJobCreate(files=files))

    assert db_session.scalar(select(ImportJob)) is None


@pytest.mark.parametrize(
    "relative_path",
    [
        "/absolute/image.dcm",
        r"C:\absolute\image.dcm",
        "study//image.dcm",
        "study/./image.dcm",
        "study/../image.dcm",
        "study/image\x00.dcm",
        "study/image\x1f.dcm",
    ],
)
def test_create_job_rejects_unsafe_relative_paths(
    db_session: Session,
    relative_path: str,
) -> None:
    patient = _patient(db_session, str(uuid4()))

    with pytest.raises(ImportFileMismatchError) as captured:
        _create_job(db_session, patient, _manifest_file(relative_path))

    assert relative_path not in str(captured.value)
    assert db_session.scalar(select(ImportJob)) is None


def test_create_job_normalizes_slashes_and_rejects_duplicate_paths(
    db_session: Session,
) -> None:
    patient = _patient(db_session)

    with pytest.raises(ImportFileMismatchError):
        _create_job(
            db_session,
            patient,
            _manifest_file(r"study\image.dcm"),
            _manifest_file("study/image.dcm"),
        )

    assert db_session.scalar(select(ImportJob)) is None


def test_create_job_requires_patient_and_only_one_active_job(
    db_session: Session,
) -> None:
    with pytest.raises(PatientNotFoundError):
        create_job(db_session, uuid4(), _payload())

    patient = _patient(db_session)
    first = _create_job(db_session, patient)

    with pytest.raises(ImportJobConflictError) as captured:
        _create_job(db_session, patient)

    assert captured.value.code == "import_job_conflict"
    assert first.status == "uploading"


def test_create_and_get_job_return_complete_strict_utc_dto(
    db_session: Session,
) -> None:
    patient = _patient(db_session)
    created = _create_job(
        db_session,
        patient,
        _manifest_file(r"study\image-002.dcm", size_bytes=20),
        _manifest_file("study/image-001.dcm", size_bytes=10),
    )

    assert created.model_config["extra"] == "forbid"
    assert created.status == "uploading"
    assert created.total_files == 2
    assert created.total_bytes == 30
    assert created.uploaded_bytes == 0
    assert [item.ordinal for item in created.files] == [0, 1]
    assert created.files[0].relative_path == "study/image-002.dcm"
    assert created.files[0].confirmed_offset == 0
    assert created.report is None
    assert created.error_code is None
    assert created.error_message is None
    assert created.started_at is None
    assert created.completed_at is None
    assert created.created_at.tzinfo == timezone.utc
    assert created.updated_at.tzinfo == timezone.utc
    assert created.model_dump(mode="json")["created_at"].endswith("Z")

    assert get_job(db_session, created.id) == created
    assert get_latest_job(db_session, patient.id) == created


def test_get_latest_requires_patient_and_get_job_uses_safe_not_found_error(
    db_session: Session,
) -> None:
    with pytest.raises(PatientNotFoundError):
        get_latest_job(db_session, uuid4())

    missing_id = uuid4()
    with pytest.raises(ImportJobNotFoundError) as captured:
        get_job(db_session, missing_id)

    assert captured.value.code == "import_job_not_found"
    assert str(missing_id) not in str(captured.value)


def test_not_found_reads_rollback_session_before_reraising(
    db_session: Session,
) -> None:
    with pytest.raises(PatientNotFoundError):
        get_latest_job(db_session, uuid4())
    assert not db_session.in_transaction()

    with pytest.raises(ImportJobNotFoundError):
        get_job(db_session, uuid4())
    assert not db_session.in_transaction()


@pytest.mark.parametrize(
    ("database_message", "expected_error"),
    [
        (
            "UNIQUE constraint failed: import_jobs.patient_id, import_jobs.active_slot",
            ImportJobConflictError,
        ),
        ("CHECK constraint failed: total_files", PersistenceError),
    ],
)
def test_create_job_maps_only_active_unique_integrity_error_to_conflict(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    database_message: str,
    expected_error: type[Exception],
) -> None:
    patient = _patient(db_session)
    database_error = IntegrityError("INSERT", {}, Exception(database_message))

    def raise_integrity_error() -> None:
        raise database_error

    monkeypatch.setattr(db_session, "flush", raise_integrity_error)

    with pytest.raises(expected_error):
        _create_job(db_session, patient)

    assert not db_session.in_transaction()


def test_record_confirmed_offset_requires_exact_offset_and_updates_aggregate(
    db_session: Session,
) -> None:
    job = _create_job(
        db_session,
        _patient(db_session),
        _manifest_file("one.dcm", size_bytes=10),
        _manifest_file("two.dcm", size_bytes=20),
    )
    first_file, second_file = job.files

    first_progress = record_confirmed_offset(
        db_session,
        job.id,
        first_file.id,
        expected_offset=0,
        new_offset=7,
    )
    second_progress = record_confirmed_offset(
        db_session,
        job.id,
        second_file.id,
        expected_offset=0,
        new_offset=5,
    )

    assert first_progress.file_id == first_file.id
    assert first_progress.confirmed_offset == 7
    assert first_progress.uploaded_bytes == 7
    assert first_progress.total_bytes == 30
    assert second_progress.uploaded_bytes == 12
    assert get_job(db_session, job.id).uploaded_bytes == 12

    with pytest.raises(ImportOffsetConflictError):
        record_confirmed_offset(
            db_session,
            job.id,
            first_file.id,
            expected_offset=0,
            new_offset=8,
        )
    with pytest.raises(ImportOffsetConflictError):
        record_confirmed_offset(
            db_session,
            job.id,
            first_file.id,
            expected_offset=7,
            new_offset=11,
        )

    assert get_job(db_session, job.id).uploaded_bytes == 12


def test_record_confirmed_offset_rejects_wrong_file_and_wrong_state(
    db_session: Session,
) -> None:
    first_patient = _patient(db_session, "first")
    second_patient = _patient(db_session, "second")
    first_job = _create_job(db_session, first_patient)
    second_job = _create_job(db_session, second_patient)

    with pytest.raises(ImportFileMismatchError):
        record_confirmed_offset(
            db_session,
            first_job.id,
            second_job.files[0].id,
            expected_offset=0,
            new_offset=1,
        )

    record_confirmed_offset(
        db_session,
        first_job.id,
        first_job.files[0].id,
        expected_offset=0,
        new_offset=10,
    )
    queue_job(db_session, first_job.id)
    with pytest.raises(ImportJobStateConflictError):
        record_confirmed_offset(
            db_session,
            first_job.id,
            first_job.files[0].id,
            expected_offset=10,
            new_offset=10,
        )


def test_queue_requires_uploading_and_all_files_complete(
    db_session: Session,
) -> None:
    job = _create_job(db_session, _patient(db_session))

    with pytest.raises(ImportFileMismatchError):
        queue_job(db_session, job.id)

    record_confirmed_offset(
        db_session,
        job.id,
        job.files[0].id,
        expected_offset=0,
        new_offset=10,
    )
    queued = queue_job(db_session, job.id)

    assert queued.status == "queued"
    assert queued.updated_at >= job.updated_at
    with pytest.raises(ImportJobStateConflictError):
        queue_job(db_session, job.id)


def test_running_complete_and_normal_dicom_failure_report_are_terminal(
    db_session: Session,
) -> None:
    job = _create_job(db_session, _patient(db_session))
    record_confirmed_offset(
        db_session,
        job.id,
        job.files[0].id,
        expected_offset=0,
        new_offset=10,
    )
    queue_job(db_session, job.id)
    running = mark_job_running(db_session, job.id)

    assert running.status == "running"
    assert running.started_at is not None
    completed = complete_job(db_session, job.id, _complete_report(failed=True))

    assert completed.status == "completed"
    assert completed.report is not None
    assert completed.report.failed == 1
    assert completed.error_code is None
    assert completed.error_message is None
    assert completed.completed_at == completed.updated_at
    stored = db_session.get(ImportJob, job.id)
    assert stored is not None
    assert stored.active_slot is None


@pytest.mark.parametrize(
    ("operation", "expected_code"),
    [
        ("run", "import_job_state_conflict"),
        ("complete", "import_job_state_conflict"),
        ("fail", "import_job_state_conflict"),
    ],
)
def test_transitions_reject_wrong_source_state(
    db_session: Session,
    operation: str,
    expected_code: str,
) -> None:
    job = _create_job(db_session, _patient(db_session))

    with pytest.raises(ImportJobStateConflictError) as captured:
        if operation == "run":
            mark_job_running(db_session, job.id)
        elif operation == "complete":
            complete_job(db_session, job.id, _complete_report())
        else:
            fail_job(db_session, job.id, code="import_failed", message="导入失败")

    assert captured.value.code == expected_code


@pytest.mark.parametrize("source_status", ["queued", "running"])
def test_fail_job_accepts_only_worker_states_and_saves_safe_error(
    db_session: Session,
    source_status: str,
) -> None:
    job = _create_job(db_session, _patient(db_session))
    record_confirmed_offset(
        db_session,
        job.id,
        job.files[0].id,
        expected_offset=0,
        new_offset=10,
    )
    queue_job(db_session, job.id)
    if source_status == "running":
        mark_job_running(db_session, job.id)

    failed = fail_job(
        db_session,
        job.id,
        code="storage_error",
        message="后台导入失败，请重试",
    )

    assert failed.status == "failed"
    assert failed.report is None
    assert failed.error_code == "storage_error"
    assert failed.error_message == "后台导入失败，请重试"
    assert failed.completed_at == failed.updated_at
    stored = db_session.get(ImportJob, job.id)
    assert stored is not None
    assert stored.active_slot is None


@pytest.mark.parametrize("status", ["queued", "running"])
def test_delete_rejects_queued_and_running_jobs(
    db_session: Session,
    status: str,
) -> None:
    job = _create_job(db_session, _patient(db_session))
    record_confirmed_offset(
        db_session,
        job.id,
        job.files[0].id,
        expected_offset=0,
        new_offset=10,
    )
    queue_job(db_session, job.id)
    if status == "running":
        mark_job_running(db_session, job.id)

    with pytest.raises(ImportJobStateConflictError):
        delete_job(db_session, job.id)

    assert db_session.get(ImportJob, job.id) is not None


@pytest.mark.parametrize("status", ["uploading", "completed", "failed"])
def test_delete_removes_allowed_job_and_files(
    db_session: Session,
    status: str,
) -> None:
    job = _create_job(db_session, _patient(db_session))
    if status != "uploading":
        record_confirmed_offset(
            db_session,
            job.id,
            job.files[0].id,
            expected_offset=0,
            new_offset=10,
        )
        queue_job(db_session, job.id)
        if status == "completed":
            mark_job_running(db_session, job.id)
            complete_job(db_session, job.id, _complete_report())
        else:
            fail_job(
                db_session,
                job.id,
                code="import_failed",
                message="后台导入失败，请重试",
            )

    file_ids = [item.id for item in job.files]
    delete_job(db_session, job.id)

    assert db_session.get(ImportJob, job.id) is None
    assert not db_session.scalars(
        select(ImportJobFile).where(ImportJobFile.id.in_(file_ids))
    ).all()


def test_all_import_job_errors_have_stable_safe_messages() -> None:
    expected: dict[type[Exception], tuple[int, str]] = {
        ImportJobNotFoundError: (404, "import_job_not_found"),
        ImportJobConflictError: (409, "import_job_conflict"),
        ImportJobStateConflictError: (409, "import_job_state_conflict"),
        ImportOffsetConflictError: (409, "import_offset_conflict"),
        ImportFileMismatchError: (409, "import_file_mismatch"),
        ImportInProgressError: (409, "import_in_progress"),
    }

    for error_type, (status_code, code) in expected.items():
        error = error_type()
        assert getattr(error, "status_code") == status_code
        assert getattr(error, "code") == code
        assert "C:\\private\\patient.dcm" not in str(error)
        assert "SELECT" not in str(error)
