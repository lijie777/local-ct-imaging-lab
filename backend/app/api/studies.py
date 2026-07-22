from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.patients import request_session
from app.core.errors import ErrorResponse
from app.schemas.dicom_import import SeriesDetailRead, SeriesRead, StudyRead
from app.services.study_service import (
    get_series_details,
    list_patient_studies,
    list_study_series,
)


router = APIRouter(tags=["Studies"])


@router.get(
    "/patients/{patient_id}/studies",
    response_model=list[StudyRead],
    operation_id="listPatientStudies",
    summary="List studies imported for one patient",
    responses={
        404: {"model": ErrorResponse, "description": "Patient does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def list_patient_study_records(
    patient_id: UUID,
    session: Session = Depends(request_session),
) -> list[StudyRead]:
    return list_patient_studies(session, patient_id)


@router.get(
    "/studies/{study_id}/series",
    response_model=list[SeriesRead],
    operation_id="listStudySeries",
    summary="List series within one study",
    responses={
        404: {"model": ErrorResponse, "description": "Study does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def list_study_series_records(
    study_id: UUID,
    session: Session = Depends(request_session),
) -> list[SeriesRead]:
    return list_study_series(session, study_id)


@router.get(
    "/series/{series_id}",
    response_model=SeriesDetailRead,
    operation_id="getSeriesDetails",
    summary="Get series metadata and instance summaries",
    responses={
        404: {"model": ErrorResponse, "description": "Series does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def get_series_detail_record(
    series_id: UUID,
    session: Session = Depends(request_session),
) -> SeriesDetailRead:
    return get_series_details(session, series_id)
