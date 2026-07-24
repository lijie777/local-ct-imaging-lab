from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.patients import request_session
from app.core.errors import ErrorResponse
from app.schemas.viewer_state import ViewerStateRead, ViewerStateWrite
from app.services.viewer_state_service import (
    delete_viewer_state,
    get_viewer_state,
    put_viewer_state,
)


router = APIRouter(prefix="/series/{series_id}/viewer-state", tags=["Viewer State"])


@router.get(
    "",
    response_model=ViewerStateRead | None,
    operation_id="getViewerState",
    summary="Get the saved viewer state for a Series",
    responses={
        404: {"model": ErrorResponse, "description": "Series does not exist"},
        422: {"model": ErrorResponse, "description": "Request or saved state is invalid"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def get_series_viewer_state(
    series_id: UUID,
    session: Session = Depends(request_session),
) -> ViewerStateRead | None:
    return get_viewer_state(session, series_id)


@router.put(
    "",
    response_model=ViewerStateRead,
    operation_id="putViewerState",
    summary="Replace the saved viewer state for a Series",
    responses={
        404: {"model": ErrorResponse, "description": "Series does not exist"},
        422: {"model": ErrorResponse, "description": "Viewer state is invalid"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def put_series_viewer_state(
    series_id: UUID,
    payload: ViewerStateWrite,
    session: Session = Depends(request_session),
) -> ViewerStateRead:
    return put_viewer_state(session, series_id, payload)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteViewerState",
    summary="Delete the saved viewer state for a Series",
    responses={
        204: {"description": "Viewer state deleted; no response body"},
        404: {"model": ErrorResponse, "description": "Series does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def delete_series_viewer_state(
    series_id: UUID,
    session: Session = Depends(request_session),
) -> Response:
    delete_viewer_state(session, series_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
