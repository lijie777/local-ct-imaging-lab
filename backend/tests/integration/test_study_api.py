from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.dicom_factory import write_dicom_file


def _create_patient(client: TestClient) -> dict:
    response = client.post(
        "/api/patients",
        json={"medical_record_no": "MR-DICOM-001", "name": "Teaching"},
    )
    assert response.status_code == 201
    return response.json()


def test_patient_studies_are_empty_before_import(client: TestClient) -> None:
    patient = _create_patient(client)

    response = client.get(f"/api/patients/{patient['id']}/studies")

    assert response.status_code == 200
    assert response.json() == []


def test_import_updates_patient_summary_and_exposes_study_series_details(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(tmp_path / "study.dcm")
    imported = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[("files", ("study.dcm", fixture.path.read_bytes(), "application/dicom"))],
    )
    assert imported.status_code == 200

    patient_detail = client.get(f"/api/patients/{patient['id']}")
    studies = client.get(f"/api/patients/{patient['id']}/studies")

    assert patient_detail.status_code == 200
    assert patient_detail.json()["study_count"] == 1
    assert patient_detail.json()["latest_study_date"] == "2026-07-20"
    assert studies.status_code == 200
    assert len(studies.json()) == 1
    study = studies.json()[0]
    assert study["study_instance_uid"] == fixture.study_uid
    assert study["series_count"] == 1
    assert study["instance_count"] == 1

    series_response = client.get(f"/api/studies/{study['id']}/series")
    assert series_response.status_code == 200
    series = series_response.json()[0]
    assert series["series_instance_uid"] == fixture.series_uid
    assert series["instance_count"] == 1
    assert series["viewability_status"] == "eligible"

    detail_response = client.get(f"/api/series/{series['id']}")
    assert detail_response.status_code == 200
    assert detail_response.json()["instances"][0]["sop_instance_uid"] == fixture.sop_uid
    assert "managed_path" not in detail_response.text


def test_study_endpoints_map_not_found_and_invalid_ids(client: TestClient) -> None:
    patient = _create_patient(client)

    unknown_patient = client.get(f"/api/patients/{uuid4()}/studies")
    unknown_study = client.get(f"/api/studies/{uuid4()}/series")
    unknown_series = client.get(f"/api/series/{uuid4()}")
    invalid_study = client.get("/api/studies/not-a-uuid/series")

    assert unknown_patient.status_code == 404
    assert unknown_patient.json()["error"]["code"] == "patient_not_found"
    assert unknown_study.status_code == 404
    assert unknown_study.json()["error"]["code"] == "study_not_found"
    assert unknown_series.status_code == 404
    assert unknown_series.json()["error"]["code"] == "series_not_found"
    assert invalid_study.status_code == 422
    assert invalid_study.json()["error"]["code"] == "validation_error"

    existing_patient_studies = client.get(f"/api/patients/{patient['id']}/studies")
    assert existing_patient_studies.status_code == 200


def test_deleted_patient_study_resources_are_not_exposed(
    tmp_path: Path,
    client: TestClient,
) -> None:
    patient = _create_patient(client)
    fixture = write_dicom_file(tmp_path / "delete-study.dcm", include_geometry=False)
    imported = client.post(
        f"/api/patients/{patient['id']}/dicom-import",
        files=[
            (
                "files",
                (fixture.path.name, fixture.path.read_bytes(), "application/dicom"),
            )
        ],
    )
    assert imported.status_code == 200
    studies = client.get(f"/api/patients/{patient['id']}/studies").json()
    series = client.get(f"/api/studies/{studies[0]['id']}/series").json()
    assert series[0]["viewability_reason"] == "missing_geometry"
    assert "managed_path" not in str(studies)
    assert "managed_path" not in str(series)

    deleted = client.delete(f"/api/patients/{patient['id']}")

    assert deleted.status_code == 204
    assert client.get(f"/api/patients/{patient['id']}/studies").status_code == 404
    assert client.get(f"/api/studies/{studies[0]['id']}/series").status_code == 404
    assert client.get(f"/api/series/{series[0]['id']}").status_code == 404
