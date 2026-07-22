from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError


PATIENT_ID = "11111111-1111-4111-8111-111111111111"
CREATE_PAYLOAD = {
    "medical_record_no": " MR-0001 ",
    "name": " 演示病人 ",
    "sex": "female",
    "birth_date": "1990-01-02",
}
PUBLIC_PATIENT_FIELDS = {
    "id",
    "medical_record_no",
    "name",
    "sex",
    "birth_date",
    "study_count",
    "latest_study_date",
    "created_at",
    "updated_at",
}


def _assert_patient_response(body: dict[str, Any]) -> None:
    assert set(body) == PUBLIC_PATIENT_FIELDS
    assert body["medical_record_no"] == "MR-0001"
    assert body["name"] == "演示病人"
    assert body["sex"] == "female"
    assert body["birth_date"] == "1990-01-02"
    assert body["study_count"] == 0
    assert body["latest_study_date"] is None
    assert "medical_record_no_normalized" not in body
    assert datetime.fromisoformat(body["created_at"].replace("Z", "+00:00")).tzinfo
    assert datetime.fromisoformat(body["updated_at"].replace("Z", "+00:00")).tzinfo


def _create_patient(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/patients", json=CREATE_PAYLOAD)
    assert response.status_code == 201
    return response.json()


def test_post_creates_patient_and_returns_location_header(client: TestClient) -> None:
    response = client.post("/api/patients", json=CREATE_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    _assert_patient_response(body)
    assert response.headers["location"] == f"/api/patients/{body['id']}"


def test_get_returns_complete_patient_list(client: TestClient) -> None:
    created = _create_patient(client)

    response = client.get("/api/patients")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["id"] == created["id"]
    _assert_patient_response(response.json()[0])


def test_get_returns_patient_details(client: TestClient) -> None:
    created = _create_patient(client)

    response = client.get(f"/api/patients/{created['id']}")

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]
    _assert_patient_response(response.json())


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({**CREATE_PAYLOAD, "medical_record_no": "   "}, "medical_record_no"),
        ({**CREATE_PAYLOAD, "name": ""}, "name"),
        ({**CREATE_PAYLOAD, "sex": "invalid"}, "sex"),
        ({**CREATE_PAYLOAD, "birth_date": "2999-01-01"}, "birth_date"),
    ],
)
def test_post_returns_unified_field_validation_error(
    client: TestClient,
    payload: dict[str, Any],
    field: str,
) -> None:
    response = client.post("/api/patients", json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert set(error) == {"code", "message", "field_errors"}
    assert error["code"] == "validation_error"
    assert any(item["field"] == field for item in error["field_errors"])


def test_equivalent_medical_record_number_returns_conflict(client: TestClient) -> None:
    first = {**CREATE_PAYLOAD, "medical_record_no": " Straße-01 "}
    second = {**CREATE_PAYLOAD, "medical_record_no": "STRASSE-01"}
    assert client.post("/api/patients", json=first).status_code == 201

    response = client.post("/api/patients", json=second)

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "medical_record_no_conflict",
            "message": "病历号已存在",
            "field_errors": [
                {
                    "field": "medical_record_no",
                    "code": "not_unique",
                    "message": "该病历号已被使用",
                }
            ],
        }
    }


class _FailingSession:
    def __enter__(self) -> _FailingSession:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _raise_persistence_error(self, *_args: object, **_kwargs: object) -> None:
        raise SQLAlchemyError(
            r"sqlite D:\private\patient.sqlite3 internal traceback secret"
        )

    execute = _raise_persistence_error
    scalars = _raise_persistence_error
    scalar = _raise_persistence_error
    get = _raise_persistence_error
    flush = _raise_persistence_error
    commit = _raise_persistence_error
    refresh = _raise_persistence_error

    def add(self, _instance: object) -> None:
        return None

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None


class _FailingSessionFactory:
    def __call__(self) -> _FailingSession:
        return _FailingSession()


@pytest.mark.parametrize(
    "perform_request",
    [
        pytest.param(lambda client: client.get("/api/patients"), id="list"),
        pytest.param(
            lambda client: client.post("/api/patients", json=CREATE_PAYLOAD),
            id="create",
        ),
        pytest.param(
            lambda client: client.get(f"/api/patients/{PATIENT_ID}"),
            id="detail",
        ),
    ],
)
def test_persistence_failures_return_sanitized_error(
    application: FastAPI,
    client: TestClient,
    perform_request: Callable[[TestClient], Any],
) -> None:
    application.state.session_factory = _FailingSessionFactory()

    response = perform_request(client)

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "persistence_error",
            "message": "无法保存本次操作，请重试",
            "field_errors": [],
        }
    }
    response_text = response.text.lower()
    for internal_detail in ("sqlite", "private", "traceback", "secret"):
        assert internal_detail not in response_text
