from __future__ import annotations

from collections.abc import Iterator
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorResponse, FieldError
from app.schemas.patient import PatientCreate, PatientPatch, PatientRead
from app.services.patient_service import (
    create_patient,
    delete_patient,
    get_patient,
    list_patients,
    update_patient,
)
from app.services.patient_validation import PatientValidationError
from app.services.managed_storage import ManagedStorage


router = APIRouter(prefix="/patients", tags=["Patients"])


def request_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def request_managed_storage(request: Request) -> ManagedStorage:
    return request.app.state.managed_storage


def _validation_error(error: PatientValidationError) -> ApiError:
    return ApiError(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        code="validation_error",
        message="请求字段无效",
        field_errors=[
            FieldError(
                field=error.field,
                code=error.code,
                message=error.message,
            )
        ],
    )


@router.get(
    "",
    response_model=list[PatientRead],
    operation_id="listPatients",
    summary="List or search patients",
    responses={
        500: {
            "model": ErrorResponse,
            "description": "Local persistence failed",
        }
    },
)
def list_patient_records(
    q: str | None = Query(default=None),
    session: Session = Depends(request_session),
) -> list[PatientRead]:
    return list_patients(session, q)


@router.post(
    "",
    response_model=PatientRead,
    status_code=status.HTTP_201_CREATED,
    operation_id="createPatient",
    summary="Create a patient",
    responses={
        201: {
            "description": "Patient created",
            "headers": {
                "Location": {
                    "description": "Relative URL of the created patient resource",
                    "schema": {"type": "string"},
                }
            },
        },
        409: {
            "model": ErrorResponse,
            "description": "The normalized medical record number already exists",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request or field validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Local persistence failed",
        },
    },
)
def create_patient_record(
    payload: PatientCreate,
    response: Response,
    session: Session = Depends(request_session),
) -> PatientRead:
    try:
        patient = create_patient(session, payload)
    except PatientValidationError as error:
        raise _validation_error(error) from error

    response.headers["Location"] = f"/api/patients/{patient.id}"
    return patient


@router.get(
    "/{id}",
    response_model=PatientRead,
    operation_id="getPatient",
    summary="Get patient details",
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Patient does not exist",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request or field validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Local persistence failed",
        },
    },
)
def get_patient_record(
    id: UUID,
    session: Session = Depends(request_session),
) -> PatientRead:
    return get_patient(session, id)


@router.patch(
    "/{id}",
    response_model=PatientRead,
    operation_id="updatePatient",
    summary="Update one or more editable patient fields",
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Patient does not exist",
        },
        409: {
            "model": ErrorResponse,
            "description": "The normalized medical record number already exists",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request or field validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Local persistence failed",
        },
    },
)
def update_patient_record(
    id: UUID,
    payload: PatientPatch,
    session: Session = Depends(request_session),
) -> PatientRead:
    try:
        return update_patient(session, id, payload)
    except PatientValidationError as error:
        raise _validation_error(error) from error


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deletePatient",
    summary="Permanently delete a patient",
    responses={
        204: {
            "description": "Patient permanently deleted; no response body",
        },
        404: {
            "model": ErrorResponse,
            "description": "Patient does not exist",
        },
        409: {
            "model": ErrorResponse,
            "description": "Patient has an active import job",
        },
        422: {
            "model": ErrorResponse,
            "description": "Request or field validation failed",
        },
        500: {
            "model": ErrorResponse,
            "description": "Local persistence failed",
        },
    },
)
def delete_patient_record(
    id: UUID,
    session: Session = Depends(request_session),
    storage: ManagedStorage = Depends(request_managed_storage),
) -> Response:
    delete_patient(session, id, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
