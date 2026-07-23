from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterable
from typing import Annotated, BinaryIO
from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, Headers
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.responses import Response

from app.api.patients import request_session
from app.core.errors import ErrorResponse, ImportLimitExceededError, PersistenceError
from app.schemas.dicom_import import ImportReport
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.managed_storage import ManagedStorage, ManagedStorageError


COPY_CHUNK_BYTES = 1024 * 1024
MAX_IMPORT_FILE_COUNT = 2_000
MAX_IMPORT_FILE_BYTES = 512 * 1024 * 1024
MAX_IMPORT_BATCH_BYTES = 8 * 1024 * 1024 * 1024
_IMPORT_SIZE_LIMIT_MESSAGE = "DICOM import size limit exceeded"


class ImportLimitMultiPartParser(MultiPartParser):
    def __init__(
        self,
        headers: Headers,
        stream: AsyncGenerator[bytes, None],
    ) -> None:
        super().__init__(
            headers,
            stream,
            max_files=MAX_IMPORT_FILE_COUNT,
        )
        self._import_file_bytes = 0
        self._import_batch_bytes = 0

    def on_part_begin(self) -> None:
        super().on_part_begin()
        self._import_file_bytes = 0

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        if self._current_part.file is not None:
            chunk_bytes = end - start
            self._import_file_bytes += chunk_bytes
            self._import_batch_bytes += chunk_bytes
            if (
                self._import_file_bytes > MAX_IMPORT_FILE_BYTES
                or self._import_batch_bytes > MAX_IMPORT_BATCH_BYTES
            ):
                raise MultiPartException(_IMPORT_SIZE_LIMIT_MESSAGE)
        super().on_part_data(data, start, end)


class ImportFormData(FormData):
    async def close(self) -> None:
        await _close_uploads(
            value
            for _key, value in self.multi_items()
            if isinstance(value, StarletteUploadFile)
        )


class ImportLimitRoute(APIRoute):
    def get_route_handler(
        self,
    ) -> Callable[[Request], Awaitable[Response]]:
        route_handler = super().get_route_handler()

        async def limited_route_handler(request: Request) -> Response:
            content_type = request.headers.get("content-type", "")
            if content_type.casefold().startswith("multipart/form-data"):
                try:
                    parser = ImportLimitMultiPartParser(
                        request.headers,
                        request.stream(),
                    )
                    form = await parser.parse()
                    request._form = ImportFormData(form.multi_items())
                except MultiPartException as error:
                    if error.message == _IMPORT_SIZE_LIMIT_MESSAGE or (
                        error.message.startswith("Too many files.")
                    ):
                        raise ImportLimitExceededError() from error
                    raise StarletteHTTPException(
                        status_code=400,
                        detail=error.message,
                    ) from error
                except OSError as error:
                    raise StarletteHTTPException(
                        status_code=400,
                        detail="There was an error parsing the body",
                    ) from error
            return await route_handler(request)

        return limited_route_handler


router = APIRouter(tags=["DICOM Import"], route_class=ImportLimitRoute)
logger = logging.getLogger(__name__)


async def _close_uploads(uploads: Iterable[StarletteUploadFile]) -> None:
    failed = 0
    for upload in uploads:
        try:
            await upload.close()
        except OSError:
            failed += 1
    if failed > 0:
        logger.warning(
            "%d uploaded temporary file(s) could not be closed cleanly",
            failed,
        )


def request_storage(request: Request) -> ManagedStorage:
    return request.app.state.managed_storage


def _display_name(filename: str | None, index: int) -> str:
    raw = (filename or f"file-{index + 1}.dcm").replace("\\", "/")
    parts = [part for part in raw.split("/") if part not in {"", ".", ".."}]
    return "/".join(parts) or f"file-{index + 1}.dcm"


def _copy_upload(source: BinaryIO, target, batch_bytes: int) -> int:
    source.seek(0)
    file_bytes = 0
    with target.open("wb") as destination:
        while chunk := source.read(COPY_CHUNK_BYTES):
            file_bytes += len(chunk)
            batch_bytes += len(chunk)
            if (
                file_bytes > MAX_IMPORT_FILE_BYTES
                or batch_bytes > MAX_IMPORT_BATCH_BYTES
            ):
                raise ImportLimitExceededError()
            destination.write(chunk)
    return batch_bytes


@router.post(
    "/patients/{patient_id}/dicom-import",
    response_model=ImportReport,
    operation_id="importPatientDicom",
    summary="Import local CT DICOM files for a patient",
    responses={
        404: {"model": ErrorResponse, "description": "Patient does not exist"},
        413: {"model": ErrorResponse, "description": "Import limit exceeded"},
        422: {"model": ErrorResponse, "description": "Request validation failed"},
        500: {"model": ErrorResponse, "description": "Local persistence failed"},
    },
)
async def import_patient_dicom(
    patient_id: UUID,
    files: Annotated[
        list[UploadFile],
        File(
            ...,
            max_length=MAX_IMPORT_FILE_COUNT,
            description=(
                "1-2,000 files; each file is limited to 512 MiB and "
                "the batch is limited to 8 GiB"
            ),
        ),
    ],
    session: Session = Depends(request_session),
    storage: ManagedStorage = Depends(request_storage),
) -> ImportReport:
    if len(files) > MAX_IMPORT_FILE_COUNT:
        await _close_uploads(files)
        raise ImportLimitExceededError()

    try:
        import_session = storage.create_import_session()
    except ManagedStorageError as error:
        raise PersistenceError() from error

    sources: list[ImportSource] = []
    batch_bytes = 0
    try:
        for index, upload in enumerate(files):
            target = import_session.file_path(index)
            try:
                batch_bytes = await run_in_threadpool(
                    _copy_upload,
                    upload.file,
                    target,
                    batch_bytes,
                )
            except (OSError, ManagedStorageError) as error:
                raise PersistenceError() from error
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
        try:
            await run_in_threadpool(import_session.cleanup)
        except OSError:
            logger.warning(
                "Temporary import session cleanup failed; retry will occur "
                "on the next application start"
            )
        await _close_uploads(files)
