from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import PersistenceError
from app.services.import_job_storage import ImportJobStorage


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


def _patient(client: TestClient) -> str:
    response = client.post(
        "/api/patients",
        json={"medical_record_no": f"IMPORT-{uuid4()}", "name": "导入测试"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def _manifest(path: str, content: bytes, fingerprint: str | None = None) -> dict:
    return {
        "relative_path": path,
        "size_bytes": len(content),
        "last_modified_ms": 1,
        "resume_fingerprint": fingerprint or _fingerprint(path, content),
    }


def test_import_job_create_latest_detail_and_staging(
    client: TestClient,
    application: FastAPI,
) -> None:
    patient_id = _patient(client)
    content = b"hello import"

    created = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content)]},
    )

    assert created.status_code == 201
    job = created.json()
    assert job["status"] == "uploading"
    assert job["files"][0]["confirmed_offset"] == 0
    job_dir = application.state.import_job_storage.job_directory(job["id"])
    assert job_dir.is_dir()

    latest = client.get(f"/api/patients/{patient_id}/import-jobs/latest")
    detail = client.get(f"/api/import-jobs/{job['id']}")
    assert latest.status_code == detail.status_code == 200
    assert latest.json()["id"] == detail.json()["id"] == job["id"]


def test_import_job_chunk_offset_reconcile_and_queue(client: TestClient) -> None:
    patient_id = _patient(client)
    content = b"hello import"
    job = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content)]},
    ).json()
    file_id = job["files"][0]["id"]

    wrong = client.put(
        f"/api/import-jobs/{job['id']}/files/{file_id}/content",
        headers={"Content-Type": "application/octet-stream", "Upload-Offset": "1"},
        content=content,
    )
    assert wrong.status_code == 409
    assert wrong.json()["error"]["code"] == "import_offset_conflict"

    uploaded = client.put(
        f"/api/import-jobs/{job['id']}/files/{file_id}/content",
        headers={"Content-Type": "application/octet-stream", "Upload-Offset": "0"},
        content=content,
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["confirmed_offset"] == len(content)

    queued = client.post(f"/api/import-jobs/{job['id']}/queue")
    assert queued.status_code == 202
    assert queued.json()["status"] == "queued"


def test_import_job_mismatch_delete_and_openapi_contract(
    client: TestClient,
    application: FastAPI,
) -> None:
    patient_id = _patient(client)
    content = b"hello import"
    job = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content, "0" * 64)]},
    ).json()
    file_id = job["files"][0]["id"]
    mismatch = client.put(
        f"/api/import-jobs/{job['id']}/files/{file_id}/content",
        headers={"Content-Type": "application/octet-stream", "Upload-Offset": "0"},
        content=content,
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "import_file_mismatch"
    assert client.post(f"/api/import-jobs/{job['id']}/queue").status_code == 409

    deleted = client.delete(f"/api/import-jobs/{job['id']}")
    assert deleted.status_code == 204
    assert not (
        application.state.import_job_storage.import_jobs_dir / job["id"]
    ).exists()
    assert client.get(f"/api/import-jobs/{job['id']}").status_code == 404

    paths = client.app.openapi()["paths"]
    assert "/api/import-jobs/{job_id}/files/{file_id}/content" in paths
    assert "application/octet-stream" in paths[
        "/api/import-jobs/{job_id}/files/{file_id}/content"
    ]["put"]["requestBody"]["content"]


def test_queue_waits_for_final_chunk_fingerprint_validation(
    client: TestClient,
    application: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient_id = _patient(client)
    content = b"hello import"
    job = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content, "0" * 64)]},
    ).json()
    file_id = job["files"][0]["id"]
    fingerprint_started = Event()
    release_fingerprint = Event()
    original_fingerprint = ImportJobStorage.fingerprint

    def blocking_fingerprint(self: ImportJobStorage, *args, **kwargs) -> str:
        fingerprint_started.set()
        assert release_fingerprint.wait(timeout=5)
        return original_fingerprint(self, *args, **kwargs)

    monkeypatch.setattr(ImportJobStorage, "fingerprint", blocking_fingerprint)

    with ThreadPoolExecutor(max_workers=2) as executor:
        upload_future = executor.submit(
            client.put,
            f"/api/import-jobs/{job['id']}/files/{file_id}/content",
            headers={
                "Content-Type": "application/octet-stream",
                "Upload-Offset": "0",
            },
            content=content,
        )
        assert fingerprint_started.wait(timeout=5)
        queue_future = executor.submit(
            client.post,
            f"/api/import-jobs/{job['id']}/queue",
        )
        assert not queue_future.done()
        release_fingerprint.set()
        mismatch = upload_future.result(timeout=5)
        queued = queue_future.result(timeout=5)

    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "import_file_mismatch"
    assert queued.status_code == 409
    assert client.get(f"/api/import-jobs/{job['id']}").json()["status"] == "uploading"


def test_delete_database_failure_preserves_staged_bytes(
    client: TestClient,
    application: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient_id = _patient(client)
    content = b"hello import"
    job = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content)]},
    ).json()
    file = job["files"][0]
    partial = b"hello"
    uploaded = client.put(
        f"/api/import-jobs/{job['id']}/files/{file['id']}/content",
        headers={"Content-Type": "application/octet-stream", "Upload-Offset": "0"},
        content=partial,
    )
    assert uploaded.status_code == 200
    staged_path = application.state.import_job_storage.file_path(
        job["id"],
        file["ordinal"],
    )
    assert staged_path.read_bytes() == partial

    def fail_delete(*_args, **_kwargs) -> None:
        raise PersistenceError()

    monkeypatch.setattr("app.api.import_jobs.delete_job", fail_delete)
    response = client.delete(f"/api/import-jobs/{job['id']}")

    assert response.status_code == 500
    assert staged_path.read_bytes() == partial
    detail = client.get(f"/api/import-jobs/{job['id']}")
    assert detail.status_code == 200
    assert detail.json()["files"][0]["confirmed_offset"] == len(partial)


def test_upload_offset_rejects_unbounded_decimal_header(client: TestClient) -> None:
    patient_id = _patient(client)
    content = b"hello import"
    job = client.post(
        f"/api/patients/{patient_id}/import-jobs",
        json={"files": [_manifest("study/image.dcm", content)]},
    ).json()
    file_id = job["files"][0]["id"]

    response = client.put(
        f"/api/import-jobs/{job['id']}/files/{file_id}/content",
        headers={
            "Content-Type": "application/octet-stream",
            "Upload-Offset": "9" * 21,
        },
        content=b"x",
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
