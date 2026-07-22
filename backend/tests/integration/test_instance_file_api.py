from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.instance import Instance
from app.services.managed_storage import ManagedStorage
from tests.dicom_factory import write_dicom_file


def _create_patient(client: TestClient) -> dict:
    response = client.post(
        "/api/patients",
        json={"medical_record_no": "MR-DICOM-001", "name": "Teaching"},
    )
    assert response.status_code == 201
    return response.json()


def _import_and_get_instance_id(
    client: TestClient,
    patient_id: str,
    fixture_path: Path,
) -> str:
    imported = client.post(
        f"/api/patients/{patient_id}/dicom-import",
        files=[
            (
                "files",
                (fixture_path.name, fixture_path.read_bytes(), "application/dicom"),
            )
        ],
    )
    assert imported.status_code == 200
    studies = client.get(f"/api/patients/{patient_id}/studies").json()
    series = client.get(f"/api/studies/{studies[0]['id']}/series").json()
    detail = client.get(f"/api/series/{series[0]['id']}").json()
    return detail["instances"][0]["id"]


def test_serves_managed_dicom_by_instance_resource_id(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(tmp_path / "viewable.dcm")
    instance_id = _import_and_get_instance_id(client, patient["id"], fixture.path)

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/dicom")
    assert response.headers["cache-control"] == "no-store"
    assert response.content == fixture.path.read_bytes()
    assert str(tmp_path) not in response.text


def test_unknown_and_invalid_instance_ids_return_stable_errors(
    client: TestClient,
) -> None:
    unknown = client.get(f"/api/instances/{uuid4()}/file")
    invalid = client.get("/api/instances/not-a-uuid/file")

    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "instance_not_found"
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"


def test_unsupported_series_cannot_serve_pixel_file(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(
        tmp_path / "unsupported.dcm",
        include_geometry=False,
    )
    instance_id = _import_and_get_instance_id(client, patient["id"], fixture.path)

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "series_not_viewable"


def test_missing_managed_file_returns_gone_without_path(
    tmp_path: Path,
    client: TestClient,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(tmp_path / "missing.dcm")
    instance_id = _import_and_get_instance_id(client, patient["id"], fixture.path)
    instance = db_session.get(Instance, UUID(instance_id))
    assert instance is not None
    path = managed_storage.resolve_dicom_file(instance.managed_path)
    path.unlink()

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 410
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["error"]["code"] == "dicom_file_missing"
    assert str(path) not in response.text
    assert instance.managed_path not in response.text


@pytest.mark.parametrize("managed_path", ["dicom/../../outside.dcm", "ABSOLUTE"])
def test_unsafe_managed_path_is_sanitized(
    managed_path: str,
    tmp_path: Path,
    client: TestClient,
    db_session: Session,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(tmp_path / f"unsafe-{managed_path[:3]}.dcm")
    instance_id = _import_and_get_instance_id(client, patient["id"], fixture.path)
    instance = db_session.scalar(select(Instance).where(Instance.id == UUID(instance_id)))
    assert instance is not None
    unsafe_value = (
        str((tmp_path / "private" / "outside.dcm").resolve())
        if managed_path == "ABSOLUTE"
        else managed_path
    )
    instance.managed_path = unsafe_value
    db_session.commit()

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "persistence_error"
    assert "outside" not in response.text.lower()
    assert "private" not in response.text.lower()
    assert "sqlite" not in response.text.lower()
