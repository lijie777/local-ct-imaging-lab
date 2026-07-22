from __future__ import annotations

from typing import Annotated, BinaryIO
from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.patients import request_session
from app.core.errors import ErrorResponse, PersistenceError
from app.schemas.dicom_import import ImportReport
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.managed_storage import ManagedStorage, ManagedStorageError


router = APIRouter(tags=["DICOM Import"])


def request_storage(request: Request) -> ManagedStorage:
    return request.app.state.managed_storage


def _display_name(filename: str | None, index: int) -> str:
    raw = (filename or f"file-{index + 1}.dcm").replace("\\", "/")
    parts = [part for part in raw.split("/") if part not in {"", ".", ".."}]
    return "/".join(parts) or f"file-{index + 1}.dcm"


def _copy_upload(source: BinaryIO, target) -> None:
    source.seek(0)
    with target.open("wb") as destination:
        while chunk := source.read(1024 * 1024):
            destination.write(chunk)


@router.post(
    "/patients/{patient_id}/dicom-import",
    response_model=ImportReport,
    operation_id="importPatientDicom",
    summary="Import local CT DICOM files for a patient",
    responses={
        404: {"model": ErrorResponse, "description": "Patient does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
async def import_patient_dicom(
    patient_id: UUID,
    files: Annotated[list[UploadFile], File(...)],
    session: Session = Depends(request_session),
    storage: ManagedStorage = Depends(request_storage),
) -> ImportReport:
    try:
        import_session = storage.create_import_session()
    except ManagedStorageError as error:
        raise PersistenceError() from error

    sources: list[ImportSource] = []
    try:
        for index, upload in enumerate(files):
            target = import_session.file_path(index)
            try:
                await run_in_threadpool(_copy_upload, upload.file, target)
            except (OSError, ManagedStorageError) as error:
                raise PersistenceError() from error
            finally:
                await upload.close()
            sources.append(
                ImportSource(target, _display_name(upload.filename, index))
            )
        return await run_in_threadpool(
            import_dicom_files,
            session,
            patient_id,
            sources,
            storage,
        )
    finally:
        await run_in_threadpool(import_session.cleanup)
