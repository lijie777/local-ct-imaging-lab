from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import register_error_handlers
from app.db.session import create_database
from app.main import create_app
from app.services import patient_service


def _payload(
    medical_record_no: str,
    name: str,
    *,
    sex: str = "unknown",
    birth_date: str | None = None,
) -> dict[str, Any]:
    return {
        "medical_record_no": medical_record_no,
        "name": name,
        "sex": sex,
        "birth_date": birth_date,
    }


def _create(
    client: TestClient,
    medical_record_no: str,
    name: str,
) -> dict[str, Any]:
    response = client.post(
        "/api/patients",
        json=_payload(medical_record_no, name),
    )
    assert response.status_code == 201
    return response.json()


def test_search_trims_text_matches_case_insensitively_and_escapes_like(
    client: TestClient,
) -> None:
    first = _create(client, "MR-100%_A", "Alpha Person")
    second = _create(client, "MR-200", "Beta_Name")

    assert [item["id"] for item in client.get("/api/patients?q= alpha ").json()] == [
        first["id"]
    ]
    assert [item["id"] for item in client.get("/api/patients?q=mr-100").json()] == [
        first["id"]
    ]
    assert [item["id"] for item in client.get("/api/patients?q=%25_").json()] == [
        first["id"]
    ]
    assert [item["id"] for item in client.get("/api/patients?q=_name").json()] == [
        second["id"]
    ]

    complete = client.get("/api/patients?q=   ")
    assert complete.status_code == 200
    assert {item["id"] for item in complete.json()} == {first["id"], second["id"]}


def test_patch_partially_updates_patient_and_reuses_creation_validation(
    client: TestClient,
) -> None:
    patient = _create(client, "MR-EDIT-1", "Original Name")

    response = client.patch(
        f"/api/patients/{patient['id']}",
        json={"name": " Updated Name "},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"
    assert response.json()["medical_record_no"] == "MR-EDIT-1"
    assert response.json()["birth_date"] is None

    for payload in (
        {},
        {"medical_record_no": "   "},
        {"name": "line\nbreak"},
        {"sex": "invalid"},
        {"birth_date": "2999-01-01"},
    ):
        invalid = client.patch(f"/api/patients/{patient['id']}", json=payload)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "validation_error"


def test_patch_rejects_casefold_equivalent_medical_record_number(
    client: TestClient,
) -> None:
    first = _create(client, "Straße-01", "First")
    _create(client, "MR-OTHER", "Other")

    response = client.patch(
        f"/api/patients/{first['id']}",
        json={"medical_record_no": " mr-other "},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "medical_record_no_conflict"


def test_patch_rolls_back_when_commit_fails(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = _create(client, "MR-ROLLBACK", "Before Failure")

    def fail_commit(_session: Session) -> None:
        raise SQLAlchemyError("forced patch commit failure")

    monkeypatch.setattr(Session, "commit", fail_commit)

    response = client.patch(
        f"/api/patients/{patient['id']}",
        json={"name": "Must Roll Back"},
    )

    assert response.status_code == 500
    detail = client.get(f"/api/patients/{patient['id']}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "Before Failure"


def test_stable_order_and_edit_survive_new_engine_and_session(
    client: TestClient,
    database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_time = datetime(2026, 7, 17, 9, 30, 0)
    monkeypatch.setattr(patient_service, "utc_now_for_storage", lambda: fixed_time)

    second = _create(client, "MR-B", "Second")
    first = _create(client, "MR-A", "First")
    updated = client.patch(
        f"/api/patients/{second['id']}",
        json={"name": "Second Updated"},
    )
    assert updated.status_code == 200

    initial_order = [item["id"] for item in client.get("/api/patients").json()]
    assert initial_order == [first["id"], second["id"]]

    restarted_database = create_database(database_url)
    restarted_app = create_app(session_factory=restarted_database.session_factory)
    register_error_handlers(restarted_app)
    try:
        with TestClient(restarted_app) as restarted_client:
            restarted_order = [
                item["id"] for item in restarted_client.get("/api/patients").json()
            ]
            detail = restarted_client.get(f"/api/patients/{second['id']}")
            assert restarted_order == initial_order
            assert detail.status_code == 200
            assert detail.json()["name"] == "Second Updated"
    finally:
        restarted_database.engine.dispose()
