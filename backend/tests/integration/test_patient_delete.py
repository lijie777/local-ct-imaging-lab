from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import register_error_handlers
from app.db.session import create_database
from app.main import create_app
from app.services.managed_storage import ManagedStorage


def _create(client: TestClient, suffix: str = "1") -> dict:
    response = client.post(
        "/api/patients",
        json={
            "medical_record_no": f"MR-DELETE-{suffix}",
            "name": f"Delete Patient {suffix}",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_delete_returns_empty_204_and_removes_patient(client: TestClient) -> None:
    patient = _create(client)

    response = client.delete(f"/api/patients/{patient['id']}")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/api/patients/{patient['id']}").status_code == 404


def test_delete_maps_unknown_and_invalid_ids(client: TestClient) -> None:
    unknown = client.delete(
        "/api/patients/11111111-1111-4111-8111-111111111111"
    )
    invalid = client.delete("/api/patients/not-a-uuid")

    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "patient_not_found"
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"
    assert invalid.json()["error"]["field_errors"][0]["field"] == "id"


def test_delete_is_blocked_by_active_import_until_job_is_discarded(
    client: TestClient,
) -> None:
    patient = _create(client, "active-import")
    created = client.post(
        f"/api/patients/{patient['id']}/import-jobs",
        json={
            "files": [
                {
                    "relative_path": "image.dcm",
                    "size_bytes": 4,
                    "last_modified_ms": 1,
                    "resume_fingerprint": "0" * 64,
                }
            ]
        },
    )
    assert created.status_code == 201

    blocked = client.delete(f"/api/patients/{patient['id']}")

    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "import_in_progress"
    assert client.get(f"/api/patients/{patient['id']}").status_code == 200

    assert client.delete(f"/api/import-jobs/{created.json()['id']}").status_code == 204
    assert client.delete(f"/api/patients/{patient['id']}").status_code == 204


def test_delete_failure_rolls_back_and_keeps_patient(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = _create(client, "rollback")

    def fail_commit(_session: Session) -> None:
        raise SQLAlchemyError("forced delete commit failure")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.delete(f"/api/patients/{patient['id']}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "persistence_error"
    detail = client.get(f"/api/patients/{patient['id']}")
    assert detail.status_code == 200
    assert detail.json()["medical_record_no"] == "MR-DELETE-rollback"


def test_successful_delete_does_not_return_after_new_engine(
    client: TestClient,
    database_url: str,
) -> None:
    patient = _create(client, "restart")
    assert client.delete(f"/api/patients/{patient['id']}").status_code == 204

    restarted_database = create_database(database_url)
    restarted_app = create_app(session_factory=restarted_database.session_factory)
    register_error_handlers(restarted_app)
    try:
        with TestClient(restarted_app) as restarted_client:
            assert restarted_client.get(
                f"/api/patients/{patient['id']}"
            ).status_code == 404
            assert restarted_client.get("/api/patients").json() == []
    finally:
        restarted_database.engine.dispose()


def test_startup_cleans_pending_patient_delete(
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
) -> None:
    pending = (
        managed_storage.delete_staging_dir
        / "11111111-1111-4111-8111-111111111111-"
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    )
    pending.mkdir(parents=True)
    (pending / "file.dcm").write_bytes(b"managed")

    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    assert pending.is_dir()
    with TestClient(application) as startup_client:
        assert startup_client.get("/api/patients").status_code == 200
        assert not pending.exists()


def test_startup_cleans_pending_import_session(
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
) -> None:
    pending = managed_storage.imports_dir / "pending-import"
    pending.mkdir(parents=True)
    (pending / "00000000.upload").write_bytes(b"temporary")
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    with TestClient(application) as startup_client:
        assert startup_client.get("/api/patients").status_code == 200

    assert not pending.exists()


def test_startup_cleanup_warning_does_not_block_service_or_leak_paths(
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sensitive_entry = (
        managed_storage.delete_staging_dir
        / "11111111-1111-4111-8111-111111111111-sensitive.txt"
    )
    sensitive_entry.parent.mkdir(parents=True)
    sensitive_entry.write_text("keep", encoding="utf-8")
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        with TestClient(application) as startup_client:
            response = startup_client.get("/api/patients")

    assert response.status_code == 200
    assert len(caplog.records) == 1
    assert "next application start" in caplog.records[0].getMessage()
    assert str(managed_storage.delete_staging_dir) not in caplog.text
    assert sensitive_entry.name not in caplog.text
    assert "11111111-1111-4111-8111-111111111111" not in caplog.text
    assert "Traceback" not in caplog.text


def test_startup_staging_scan_failure_warns_without_blocking_service(
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    managed_storage.delete_staging_dir.mkdir(parents=True)
    original_iterdir = Path.iterdir

    def fail_staging_scan(path: Path) -> Iterator[Path]:
        if path == managed_storage.delete_staging_dir:
            raise PermissionError("forced staging scan failure")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", fail_staging_scan)
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        with TestClient(application) as startup_client:
            response = startup_client.get("/api/patients")

    assert response.status_code == 200
    assert len(caplog.records) == 1
    assert str(managed_storage.delete_staging_dir) not in caplog.text
    assert "Traceback" not in caplog.text
