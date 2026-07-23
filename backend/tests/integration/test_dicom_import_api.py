from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.services.managed_storage import ImportSession, ManagedStorage, ManagedStorageError
from tests.dicom_factory import write_dicom_file


def _create_patient(client: TestClient) -> dict:
    response = client.post(
        "/api/patients",
        json={"medical_record_no": "MR-DICOM-001", "name": "Teaching"},
    )
    assert response.status_code == 201
    return response.json()


def test_multipart_import_returns_complete_report(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    first = write_dicom_file(tmp_path / "first.dcm", instance_number=1)
    second = write_dicom_file(
        tmp_path / "second.dcm",
        study_uid=first.study_uid,
        series_uid=first.series_uid,
        instance_number=2,
    )

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            ("files", ("folder/first.dcm", first.path.read_bytes(), "application/dicom")),
            ("files", ("folder/second.dcm", second.path.read_bytes(), "application/dicom")),
        ],
    )

    assert response.status_code == 200
    assert response.json() == {
        "total": 2,
        "success": 2,
        "duplicate": 0,
        "skipped": 0,
        "unsupported": 0,
        "failed": 0,
        "items": [
            {
                "file_name": "folder/first.dcm",
                "category": "success",
                "code": "imported",
                "message": "CT DICOM 已保存",
                "study_instance_uid": first.study_uid,
                "series_instance_uid": first.series_uid,
                "sop_instance_uid": first.sop_uid,
            },
            {
                "file_name": "folder/second.dcm",
                "category": "success",
                "code": "imported",
                "message": "CT DICOM 已保存",
                "study_instance_uid": second.study_uid,
                "series_instance_uid": second.series_uid,
                "sop_instance_uid": second.sop_uid,
            },
        ],
    }
    assert str(tmp_path.resolve()) not in response.text


def test_import_requires_files_and_valid_patient_uuid(client: TestClient) -> None:
    patient = _create_patient(client)

    missing_files = client.post(f"/api/patients/{patient['id']}/dicom-import")
    invalid_uuid = client.post(
        "/api/patients/not-a-uuid/dicom-import",
        files=[("files", ("empty.dcm", b"", "application/dicom"))],
    )

    assert missing_files.status_code == 422
    assert missing_files.json()["error"]["code"] == "validation_error"
    assert invalid_uuid.status_code == 422
    assert invalid_uuid.json()["error"]["code"] == "validation_error"


def test_import_returns_404_for_unknown_patient(client: TestClient) -> None:
    response = client.post(
        f"/api/patients/{uuid4()}/dicom-import",
        files=[("files", ("empty.dcm", b"", "application/dicom"))],
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "patient_not_found"


def test_import_initialization_failure_is_sanitized(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)

    def fail_session(_storage: ManagedStorage):
        raise ManagedStorageError(r"D:\private\dicom secret")

    monkeypatch.setattr(ManagedStorage, "create_import_session", fail_session)
    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[("files", ("image.dcm", b"data", "application/dicom"))],
    )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "persistence_error"
    assert "private" not in response.text.lower()
    assert "secret" not in response.text.lower()


def test_import_rejects_too_many_files_with_sanitized_413(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_FILE_COUNT", 1)

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            ("files", ("first.dcm", b"first", "application/dicom")),
            ("files", ("second.dcm", b"second", "application/dicom")),
        ],
    )

    assert response.status_code == 413
    assert response.json()["error"] == {
        "code": "import_limit_exceeded",
        "message": "本次导入的数据量超过教学演示上限",
        "field_errors": [],
    }
    assert "private" not in response.text.lower()


def test_import_maps_multipart_parser_file_limit_to_413(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_FILE_COUNT", 1_001)

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            ("files", (f"{index}.dcm", b"x", "application/dicom"))
            for index in range(1_002)
        ],
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "import_limit_exceeded"


def test_import_accepts_file_count_at_configured_limit(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_FILE_COUNT", 2)

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            ("files", ("first.dcm", b"first", "application/dicom")),
            ("files", ("second.dcm", b"second", "application/dicom")),
        ],
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_import_rejects_file_larger_than_limit(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_FILE_BYTES", 3)

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[("files", ("large.dcm", b"four", "application/dicom"))],
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "import_limit_exceeded"


def test_import_rejects_batch_larger_than_limit(
    client: TestClient,
    monkeypatch,
) -> None:
    patient = _create_patient(client)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_FILE_BYTES", 4)
    monkeypatch.setattr("app.api.dicom_import.MAX_IMPORT_BATCH_BYTES", 5)

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            ("files", ("first.dcm", b"one", "application/dicom")),
            ("files", ("second.dcm", b"two", "application/dicom")),
        ],
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "import_limit_exceeded"


def test_successful_report_is_preserved_when_import_session_cleanup_fails(
    client: TestClient,
    monkeypatch,
    caplog,
) -> None:
    patient = _create_patient(client)

    def fail_cleanup(_session: ImportSession) -> None:
        raise OSError(r"D:\private\temporary cleanup failure")

    monkeypatch.setattr(ImportSession, "cleanup", fail_cleanup)
    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[("files", ("invalid.dcm", b"not dicom", "application/dicom"))],
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["skipped"] == 1
    assert "private" not in caplog.text.lower()


def test_upload_close_failure_does_not_override_report_or_session_cleanup(
    client: TestClient,
    managed_storage: ManagedStorage,
    monkeypatch,
    caplog,
) -> None:
    patient = _create_patient(client)

    async def fail_close(_upload: StarletteUploadFile) -> None:
        raise OSError(r"D:\private\temporary upload close failure")

    monkeypatch.setattr(StarletteUploadFile, "close", fail_close)
    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[("files", ("invalid.dcm", b"not dicom", "application/dicom"))],
    )

    assert response.status_code == 200
    assert response.json()["skipped"] == 1
    assert list(managed_storage.imports_dir.iterdir()) == []
    assert "private" not in caplog.text.lower()


def test_mixed_multipart_import_returns_five_category_report(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    duplicate = write_dicom_file(tmp_path / "duplicate.dcm")
    first_response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            (
                "files",
                (duplicate.path.name, duplicate.path.read_bytes(), "application/dicom"),
            )
        ],
    )
    assert first_response.status_code == 200
    unsupported = write_dicom_file(
        tmp_path / "unsupported.dcm",
        include_geometry=False,
    )
    non_ct = write_dicom_file(tmp_path / "non-ct.dcm", modality="MR")
    damaged = (b"\0" * 128) + b"DICM" + b"damaged"

    response = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            (
                "files",
                ("duplicate.dcm", duplicate.path.read_bytes(), "application/dicom"),
            ),
            (
                "files",
                ("unsupported.dcm", unsupported.path.read_bytes(), "application/dicom"),
            ),
            (
                "files",
                ("non-ct.dcm", non_ct.path.read_bytes(), "application/dicom"),
            ),
            ("files", ("damaged.dcm", damaged, "application/dicom")),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert {
        key: body[key]
        for key in ("total", "success", "duplicate", "skipped", "unsupported", "failed")
    } == {
        "total": 4,
        "success": 0,
        "duplicate": 1,
        "skipped": 1,
        "unsupported": 1,
        "failed": 1,
    }
    assert sum(body[key] for key in ("success", "duplicate", "skipped", "unsupported", "failed")) == body["total"]
    assert [item["file_name"] for item in body["items"]] == [
        "duplicate.dcm",
        "unsupported.dcm",
        "non-ct.dcm",
        "damaged.dcm",
    ]
    assert all(item["code"] and item["message"] for item in body["items"])
    assert str(tmp_path.resolve()) not in response.text
