from __future__ import annotations

import asyncio
import re
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.patients import request_session
from app.core.errors import (
    ApiError,
    ErrorResponse,
    FieldError,
    ImportFileMismatchError,
    ImportJobStateConflictError,
    ImportLimitExceededError,
    ImportOffsetConflictError,
    PersistenceError,
)
from app.schemas.import_job import (
    ImportJobCreate,
    ImportJobRead,
    ImportUploadProgressRead,
)
from app.services.import_job_service import (
    create_job,
    delete_job,
    get_job,
    get_latest_job,
    queue_job,
    reconcile_confirmed_offset,
    record_confirmed_offset,
)
from app.services.import_job_storage import (
    CHUNK_BYTES,
    ImportJobFileMismatchError as StorageFileMismatchError,
    ImportJobStorage,
)
from app.services.managed_storage import ManagedStorageError


router = APIRouter(prefix="", tags=["Import Jobs"])
_DECIMAL_OFFSET = re.compile(r"^[0-9]{1,20}$")


def request_import_job_storage(request: Request) -> ImportJobStorage:
    return request.app.state.import_job_storage


def _validation_error(field: str, code: str = "invalid") -> ApiError:
    return ApiError(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        code="validation_error",
        message="请求字段无效",
        field_errors=[FieldError(field=field, code=code, message="字段值无效")],
    )


async def _read_chunk(request: Request) -> bytes:
    chunks: list[bytes] = []
    total = 0
    async for part in request.stream():
        if not part:
            continue
        total += len(part)
        if total > CHUNK_BYTES:
            raise ImportLimitExceededError()
        chunks.append(part)
    if total < 1:
        raise ImportLimitExceededError()
    return b"".join(chunks)


@router.post(
    "/patients/{patient_id}/import-jobs",
    response_model=ImportJobRead,
    status_code=status.HTTP_201_CREATED,
    operation_id="createImportJob",
    summary="Create a resumable import job",
    responses={
        404: {"model": ErrorResponse, "description": "Patient does not exist"},
        409: {"model": ErrorResponse, "description": "An active import already exists"},
        413: {"model": ErrorResponse, "description": "Import limit exceeded"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def create_import_job(
    patient_id: UUID,
    payload: ImportJobCreate,
    session: Session = Depends(request_session),
    storage: ImportJobStorage = Depends(request_import_job_storage),
) -> ImportJobRead:
    job = create_job(session, patient_id, payload)
    try:
        storage.ensure_job_dir(job.id)
    except (ManagedStorageError, OSError) as error:
        try:
            storage.cleanup_job(job.id)
        except (ManagedStorageError, OSError):
            pass
        try:
            delete_job(session, job.id)
        except Exception:
            session.rollback()
        raise PersistenceError() from error
    return job


@router.get(
    "/patients/{patient_id}/import-jobs/latest",
    response_model=ImportJobRead | None,
    operation_id="getLatestImportJob",
    summary="Get the latest import job for a patient",
    responses={
        404: {"model": ErrorResponse, "description": "Patient does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def get_latest_import_job(
    patient_id: UUID,
    session: Session = Depends(request_session),
) -> ImportJobRead | None:
    return get_latest_job(session, patient_id)


@router.get(
    "/import-jobs/{job_id}",
    response_model=ImportJobRead,
    operation_id="getImportJob",
    summary="Get an import job",
    responses={
        404: {"model": ErrorResponse, "description": "Import job does not exist"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
def get_import_job(
    job_id: UUID,
    session: Session = Depends(request_session),
) -> ImportJobRead:
    return get_job(session, job_id)


@router.put(
    "/import-jobs/{job_id}/files/{file_id}/content",
    response_model=ImportUploadProgressRead,
    operation_id="uploadImportJobFileChunk",
    summary="Upload one resumable import chunk",
    responses={
        404: {"model": ErrorResponse, "description": "Import job does not exist"},
        409: {"model": ErrorResponse, "description": "Import upload conflict"},
        413: {"model": ErrorResponse, "description": "Chunk exceeds import limit"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
async def upload_import_job_chunk(
    request: Request,
    job_id: UUID,
    file_id: UUID,
    upload_offset: str | None = Header(default=None, alias="Upload-Offset"),
    session: Session = Depends(request_session),
    storage: ImportJobStorage = Depends(request_import_job_storage),
) -> ImportUploadProgressRead:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/octet-stream":
        raise _validation_error("request", "content_type")
    if upload_offset is None or _DECIMAL_OFFSET.fullmatch(upload_offset) is None:
        raise _validation_error("request", "upload_offset")
    try:
        expected_offset = int(upload_offset)
    except ValueError as error:
        raise _validation_error("request", "upload_offset") from error

    lock: asyncio.Lock = request.app.state.import_upload_lock
    async with lock:
        job = get_job(session, job_id)
        if job.status != "uploading":
            raise ImportJobStateConflictError()
        manifest_file = next((item for item in job.files if item.id == file_id), None)
        if manifest_file is None:
            raise ImportFileMismatchError()
        if expected_offset != manifest_file.confirmed_offset:
            raise ImportOffsetConflictError()

        chunk = await _read_chunk(request)
        if expected_offset + len(chunk) > manifest_file.size_bytes:
            raise ImportLimitExceededError()
        try:
            new_offset = await run_in_threadpool(
                storage.write_chunk,
                job_id,
                manifest_file.ordinal,
                expected_offset,
                chunk,
                manifest_file.size_bytes,
            )
        except StorageFileMismatchError as error:
            raise ImportFileMismatchError() from error
        except (ManagedStorageError, OSError) as error:
            raise PersistenceError() from error

        if new_offset < expected_offset:
            return reconcile_confirmed_offset(
                session,
                job_id,
                file_id,
                new_offset,
            )

        if new_offset == manifest_file.size_bytes:
            try:
                staged_path = storage.file_path(job_id, manifest_file.ordinal)
                fingerprint = await run_in_threadpool(
                    storage.fingerprint,
                    staged_path,
                    manifest_file.relative_path,
                    manifest_file.size_bytes,
                    manifest_file.last_modified_ms,
                )
            except StorageFileMismatchError as error:
                try:
                    reconcile_confirmed_offset(session, job_id, file_id, 0)
                except Exception:
                    session.rollback()
                raise ImportFileMismatchError() from error
            except (ManagedStorageError, OSError) as error:
                raise PersistenceError() from error
            if fingerprint != manifest_file.resume_fingerprint:
                try:
                    reconcile_confirmed_offset(session, job_id, file_id, 0)
                except Exception:
                    session.rollback()
                raise ImportFileMismatchError()
        return record_confirmed_offset(
            session,
            job_id,
            file_id,
            expected_offset,
            new_offset,
        )


@router.post(
    "/import-jobs/{job_id}/queue",
    response_model=ImportJobRead,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="queueImportJob",
    summary="Queue a completed import upload",
    responses={
        404: {"model": ErrorResponse, "description": "Import job does not exist"},
        409: {"model": ErrorResponse, "description": "Import job is not queueable"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
async def queue_import_job(
    request: Request,
    job_id: UUID,
    session: Session = Depends(request_session),
) -> ImportJobRead:
    lock: asyncio.Lock = request.app.state.import_upload_lock
    async with lock:
        response = queue_job(session, job_id)
        wakeup = getattr(request.app.state, "import_job_wakeup", None)
        if wakeup is not None:
            wakeup.set()
        return response


@router.delete(
    "/import-jobs/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteImportJob",
    summary="Delete an import job and its staging files",
    responses={
        204: {"description": "Import job deleted; no response body"},
        404: {"model": ErrorResponse, "description": "Import job does not exist"},
        409: {"model": ErrorResponse, "description": "Import job is still active"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
async def delete_import_job(
    request: Request,
    job_id: UUID,
    session: Session = Depends(request_session),
    storage: ImportJobStorage = Depends(request_import_job_storage),
) -> Response:
    lock: asyncio.Lock = request.app.state.import_upload_lock
    async with lock:
        job = get_job(session, job_id)
        if job.status in {"queued", "running"}:
            raise ImportJobStateConflictError()
        delete_job(session, job_id)
        try:
            await run_in_threadpool(storage.cleanup_job, job_id)
        except (ManagedStorageError, OSError) as error:
            # The database row is already gone, so a cleanup failure can only
            # leave an orphan staging directory. Startup orphan cleanup retries
            # this without leaving confirmed offsets pointing at missing data.
            raise PersistenceError() from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
