from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study


VALID_STATE = {
    "schema_version": 1,
    "state": {
        "axial": {
            "image_index": 2,
            "active_tool": "length",
            "presentation": {
                "zoom": 1.25,
                "pan": [4.0, -2.0],
                "rotation": 0.0,
                "flip_horizontal": False,
                "flip_vertical": False,
            },
            "voi": {"lower": -160.0, "upper": 240.0, "invert": False},
        },
        "mpr": None,
        "annotations": [
            {
                "viewport": "axial",
                "tool_name": "Length",
                "referenced_image_id": "wadouri:http://127.0.0.1/api/instances/1/file",
                "points": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]],
                "label": None,
                "text_box": None,
            }
        ],
    },
}


def _create_series(session_factory: sessionmaker[Session]) -> UUID:
    with session_factory() as session:
        patient = Patient(
            medical_record_no="MR-VIEWER-STATE",
            medical_record_no_normalized="mr-viewer-state",
            name="Viewer State Teaching",
        )
        session.add(patient)
        session.flush()
        study = Study(
            patient_id=patient.id,
            study_instance_uid="1.2.826.0.1.3680043.8.498.6001",
            dicom_patient_id="MR-VIEWER-STATE",
        )
        session.add(study)
        session.flush()
        series = Series(
            study_id=study.id,
            series_instance_uid="1.2.826.0.1.3680043.8.498.6002",
            modality="CT",
            viewability_status="eligible",
        )
        session.add(series)
        session.commit()
        return series.id


def test_get_put_overwrite_and_delete_viewer_state(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    path = f"/api/series/{series_id}/viewer-state"

    empty = client.get(path)
    assert empty.status_code == 200
    assert empty.json() is None

    created = client.put(path, json=VALID_STATE)
    assert created.status_code == 200
    body = created.json()
    assert body["series_id"] == str(series_id)
    assert body["schema_version"] == 1
    assert body["state"] == VALID_STATE["state"]
    assert body["created_at"] <= body["updated_at"]

    replacement = {
        **VALID_STATE,
        "state": {**VALID_STATE["state"], "axial": None, "annotations": []},
    }
    updated = client.put(path, json=replacement)
    assert updated.status_code == 200
    assert updated.json()["state"] == replacement["state"]
    assert client.get(path).json()["state"] == replacement["state"]

    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    assert client.get(path).json() is None


def test_deleted_viewer_state_stays_deleted_after_application_restart(
    application: FastAPI,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    path = f"/api/series/{series_id}/viewer-state"

    with TestClient(application) as first_process:
        assert first_process.put(path, json=VALID_STATE).status_code == 200
        assert first_process.delete(path).status_code == 204

    with TestClient(application) as restarted_process:
        response = restarted_process.get(path)
        assert response.status_code == 200
        assert response.json() is None


def test_viewer_state_survives_new_session_and_cascades_with_patient(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    path = f"/api/series/{series_id}/viewer-state"
    assert client.put(path, json=VALID_STATE).status_code == 200

    with session_factory() as session:
        patient = session.scalar(select(Patient).where(Patient.name == "Viewer State Teaching"))
        assert patient is not None
        patient_id = patient.id
    assert client.get(path).json()["state"] == VALID_STATE["state"]

    assert client.delete(f"/api/patients/{patient_id}").status_code == 204
    assert client.get(path).status_code == 404


def test_unknown_series_returns_safe_404(client: TestClient) -> None:
    response = client.get(
        "/api/series/11111111-1111-4111-8111-111111111111/viewer-state"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "series_not_found"


def test_invalid_viewer_state_is_rejected_safely(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    path = f"/api/series/{series_id}/viewer-state"
    invalid_payloads: list[dict[str, Any]] = [
        {**VALID_STATE, "schema_version": 2},
        {**VALID_STATE, "unexpected": "private"},
        {
            **VALID_STATE,
            "state": {
                **VALID_STATE["state"],
                "annotations": [
                    {
                        "viewport": "axial",
                        "tool_name": "Crosshairs",
                        "referenced_image_id": "wadouri:http://127.0.0.1/api/instances/1/file",
                        "points": [[0, 0, 0], [1, 1, 1]],
                        "label": None,
                        "text_box": None,
                    }
                ],
            },
        },
        {
            **VALID_STATE,
            "state": {
                **VALID_STATE["state"],
                "axial": {
                    **VALID_STATE["state"]["axial"],
                    "voi": {"lower": 10, "upper": 5, "invert": False},
                },
            },
        },
        {
            **VALID_STATE,
            "state": {
                **VALID_STATE["state"],
                "annotations": [
                    {
                        key: value
                        for key, value in VALID_STATE["state"]["annotations"][0].items()
                        if key != "referenced_image_id"
                    }
                ],
            },
        },
        {
            **VALID_STATE,
            "state": {
                **VALID_STATE["state"],
                "annotations": [
                    {
                        **VALID_STATE["state"]["annotations"][0],
                        "referenced_image_id": "image\nprivate",
                    }
                ],
            },
        },
    ]

    for payload in invalid_payloads:
        response = client.put(path, json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "viewer_state_invalid"
        assert "private" not in response.text


def test_arrow_and_annotation_limits_are_enforced(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    path = f"/api/series/{series_id}/viewer-state"
    arrow = {
        "viewport": "axial",
        "tool_name": "ArrowAnnotate",
        "referenced_image_id": "wadouri:http://127.0.0.1/api/instances/1/file",
        "points": [[0, 0, 0], [1, 1, 1]],
        "label": "x" * 201,
        "text_box": None,
    }
    response = client.put(
        path,
        json={
            **VALID_STATE,
            "state": {**VALID_STATE["state"], "annotations": [arrow]},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "viewer_state_invalid"

    response = client.put(
        path,
        json={
            **VALID_STATE,
            "state": {
                **VALID_STATE["state"],
                "annotations": [VALID_STATE["state"]["annotations"][0]] * 501,
            },
        },
    )
    assert response.status_code == 422


def test_non_finite_json_number_is_rejected(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    series_id = _create_series(session_factory)
    response = client.put(
        f"/api/series/{series_id}/viewer-state",
        content=(
            '{"schema_version":1,"state":{"axial":{"image_index":0,'
            '"active_tool":"windowLevel","presentation":{"zoom":NaN},'
            '"voi":null},"mpr":null,"annotations":[]}}'
        ),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "viewer_state_invalid"


def test_viewer_state_payload_size_limit_is_enforced(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: Any,
) -> None:
    from app.services import viewer_state_service

    series_id = _create_series(session_factory)
    monkeypatch.setattr(viewer_state_service, "MAX_VIEWER_STATE_BYTES", 1)

    response = client.put(
        f"/api/series/{series_id}/viewer-state",
        json=VALID_STATE,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "viewer_state_invalid"


def test_viewer_state_persistence_failure_is_sanitized(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: Any,
) -> None:
    series_id = _create_series(session_factory)

    def fail_commit(_session: Session) -> None:
        raise SQLAlchemyError(r"sqlite D:\private\viewer-state.sqlite3 secret")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.put(
        f"/api/series/{series_id}/viewer-state",
        json=VALID_STATE,
    )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "persistence_error"
    assert "sqlite" not in response.text.lower()
    assert "private" not in response.text.lower()
