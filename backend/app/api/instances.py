from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.patients import request_managed_storage, request_session
from app.core.errors import ErrorResponse
from app.services.instance_service import get_viewable_instance_file
from app.services.managed_storage import ManagedStorage


router = APIRouter(tags=["Instances"])


@router.get(
    "/instances/{instance_id}/file",
    response_class=FileResponse,
    operation_id="getInstanceDicomFile",
    summary="Read one managed DICOM instance",
    responses={
        404: {"model": ErrorResponse, "description": "Instance does not exist"},
        409: {"model": ErrorResponse, "description": "Series is not viewable"},
        410: {"model": ErrorResponse, "description": "Managed DICOM file is missing"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def get_instance_file(
    instance_id: UUID,
    session: Session = Depends(request_session),
    storage: ManagedStorage = Depends(request_managed_storage),
) -> FileResponse:
    path = get_viewable_instance_file(session, storage, instance_id)
    return FileResponse(
        path,
        media_type="application/dicom",
        headers={"Cache-Control": "no-store"},
    )
