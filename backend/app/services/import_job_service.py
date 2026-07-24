from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    ImportFileMismatchError,
    ImportJobConflictError,
    ImportJobNotFoundError,
    ImportJobStateConflictError,
    ImportLimitExceededError,
    ImportOffsetConflictError,
    PersistenceError,
    PatientNotFoundError,
)
from app.models.common import utc_now_for_storage
from app.models.import_job import ImportJob, ImportJobFile
from app.models.patient import Patient
from app.schemas.dicom_import import ImportReport
from app.schemas.import_job import (
    ImportJobCreate,
    ImportJobFileRead,
    ImportJobRead,
    ImportJobStatus,
    ImportManifestFile,
    ImportUploadProgressRead,
)


MAX_FILES = 2_000
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024**3
_FINGERPRINT_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_SAFE_ERROR_CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_WINDOWS_ABSOLUTE = re.compile(r"^[a-zA-Z]:")
_LEAKY_MESSAGE = re.compile(
    r"(?:[a-zA-Z]:[\\/]|(?:^|\s)/[^\s]|\b(?:SELECT|INSERT|UPDATE|DELETE)\b)",
    re.IGNORECASE,
)
_GENERIC_FAILURE_MESSAGE = "后台导入失败，请删除任务后重试"


def _normalize_relative_path(value: str) -> str:
    if not isinstance(value, str):
        raise ImportFileMismatchError()
    normalized = value.replace("\\", "/")
    if not normalized or normalized.startswith("/") or _WINDOWS_ABSOLUTE.match(normalized):
        raise ImportFileMismatchError()
    if any(unicodedata.category(character) == "Cc" for character in normalized):
        raise ImportFileMismatchError()
    parts = normalized.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise ImportFileMismatchError()
    if len(normalized) > 1024:
        raise ImportFileMismatchError()
    return normalized


def _validated_manifest(payload: ImportJobCreate) -> list[ImportManifestFile]:
    try:
        raw_files: Iterable[Any] = payload.files
        files = [ImportManifestFile.model_validate(item) for item in raw_files]
    except (TypeError, ValidationError) as error:
        raise ImportFileMismatchError() from error

    if not 1 <= len(files) <= MAX_FILES:
        raise ImportLimitExceededError()

    normalized_paths: set[str] = set()
    total_bytes = 0
    result: list[ImportManifestFile] = []
    for item in files:
        if item.size_bytes < 1 or item.size_bytes > MAX_FILE_BYTES:
            raise ImportLimitExceededError()
        normalized_path = _normalize_relative_path(item.relative_path)
        if normalized_path in normalized_paths:
            raise ImportFileMismatchError()
        normalized_paths.add(normalized_path)
        if not _FINGERPRINT_PATTERN.fullmatch(item.resume_fingerprint):
            raise ImportFileMismatchError()
        total_bytes += item.size_bytes
        result.append(
            item.model_copy(update={"relative_path": normalized_path})
        )

    if total_bytes < 1 or total_bytes > MAX_TOTAL_BYTES:
        raise ImportLimitExceededError()
    return result


def _job_read(job: ImportJob) -> ImportJobRead:
    files = [
        ImportJobFileRead.model_validate(
            {
                "id": item.id,
                "ordinal": item.ordinal,
                "relative_path": item.relative_path,
                "size_bytes": item.size_bytes,
                "last_modified_ms": item.last_modified_ms,
                "resume_fingerprint": item.resume_fingerprint,
                "confirmed_offset": item.confirmed_offset,
            }
        )
        for item in sorted(job.files, key=lambda item: item.ordinal)
    ]
    return ImportJobRead.model_validate(
        {
            "id": job.id,
            "patient_id": job.patient_id,
            "status": job.status,
            "total_files": job.total_files,
            "total_bytes": job.total_bytes,
            "uploaded_bytes": job.uploaded_bytes,
            "files": files,
            "report": job.report,
            "error_code": job.error_code,
            "error_message": job.error_message,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
        }
    )


def _job_or_error(session: Session, job_id: UUID) -> ImportJob:
    job = session.get(ImportJob, job_id)
    if job is None:
        raise ImportJobNotFoundError()
    return job


def _is_active_unique_integrity_error(error: IntegrityError) -> bool:
    details = str(error.orig).lower()
    return (
        "uq_import_jobs_patient_active" in details
        or (
            "unique" in details
            and "import_jobs.patient_id" in details
            and "import_jobs.active_slot" in details
        )
    )


def _state_conflict() -> None:
    raise ImportJobStateConflictError()


def create_job(
    session: Session,
    patient_id: UUID,
    payload: ImportJobCreate,
) -> ImportJobRead:
    try:
        if session.get(Patient, patient_id) is None:
            raise PatientNotFoundError()
        files = _validated_manifest(payload)
        active_job = session.scalar(
            select(ImportJob.id).where(
                ImportJob.patient_id == patient_id,
                ImportJob.active_slot == 1,
            )
        )
        if active_job is not None:
            raise ImportJobConflictError()

        now = utc_now_for_storage()
        job = ImportJob(
            patient_id=patient_id,
            status=ImportJobStatus.UPLOADING.value,
            active_slot=1,
            total_files=len(files),
            total_bytes=sum(item.size_bytes for item in files),
            uploaded_bytes=0,
            created_at=now,
            updated_at=now,
        )
        job.files.extend(
            ImportJobFile(
                ordinal=ordinal,
                relative_path=item.relative_path,
                size_bytes=item.size_bytes,
                last_modified_ms=item.last_modified_ms,
                resume_fingerprint=item.resume_fingerprint,
                confirmed_offset=0,
            )
            for ordinal, item in enumerate(files)
        )
        session.add(job)
        session.flush()
        response = _job_read(job)
        session.commit()
        return response
    except (
        PatientNotFoundError,
        ImportLimitExceededError,
        ImportFileMismatchError,
        ImportJobConflictError,
    ):
        session.rollback()
        raise
    except IntegrityError as error:
        session.rollback()
        if _is_active_unique_integrity_error(error):
            raise ImportJobConflictError() from error
        raise PersistenceError() from error
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def get_latest_job(session: Session, patient_id: UUID) -> ImportJobRead | None:
    try:
        if session.get(Patient, patient_id) is None:
            raise PatientNotFoundError()
        job = session.scalar(
            select(ImportJob)
            .where(ImportJob.patient_id == patient_id)
            .order_by(ImportJob.created_at.desc(), ImportJob.id.desc())
            .limit(1)
        )
        return None if job is None else _job_read(job)
    except PatientNotFoundError:
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def get_job(session: Session, job_id: UUID) -> ImportJobRead:
    try:
        return _job_read(_job_or_error(session, job_id))
    except ImportJobNotFoundError:
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def record_confirmed_offset(
    session: Session,
    job_id: UUID,
    file_id: UUID,
    expected_offset: int,
    new_offset: int,
) -> ImportUploadProgressRead:
    try:
        job = _job_or_error(session, job_id)
        if job.status != ImportJobStatus.UPLOADING.value:
            _state_conflict()
        file = session.scalar(
            select(ImportJobFile).where(
                ImportJobFile.id == file_id,
                ImportJobFile.job_id == job_id,
            )
        )
        if file is None:
            raise ImportFileMismatchError()
        if expected_offset != file.confirmed_offset:
            raise ImportOffsetConflictError()
        if new_offset < file.confirmed_offset or new_offset > file.size_bytes:
            raise ImportOffsetConflictError()

        file.confirmed_offset = new_offset
        job.uploaded_bytes += new_offset - expected_offset
        job.updated_at = utc_now_for_storage()
        session.flush()
        response = ImportUploadProgressRead(
            file_id=file.id,
            confirmed_offset=file.confirmed_offset,
            uploaded_bytes=job.uploaded_bytes,
            total_bytes=job.total_bytes,
        )
        session.commit()
        return response
    except (
        ImportJobNotFoundError,
        ImportJobStateConflictError,
        ImportFileMismatchError,
        ImportOffsetConflictError,
    ):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def reconcile_confirmed_offset(
    session: Session,
    job_id: UUID,
    file_id: UUID,
    actual_offset: int,
) -> ImportUploadProgressRead:
    """Align SQLite state with the durable staging file length.

    This is only used after the storage layer reports that the disk file is
    shorter than the database-confirmed offset (for example after an
    interrupted write).  Recomputing the aggregate from every manifest file
    avoids drift when a previous request had already advanced other files.
    """
    try:
        job = _job_or_error(session, job_id)
        if job.status != ImportJobStatus.UPLOADING.value:
            _state_conflict()
        file = session.scalar(
            select(ImportJobFile).where(
                ImportJobFile.id == file_id,
                ImportJobFile.job_id == job_id,
            )
        )
        if file is None:
            raise ImportFileMismatchError()
        if (
            isinstance(actual_offset, bool)
            or not isinstance(actual_offset, int)
            or actual_offset < 0
            or actual_offset > file.size_bytes
        ):
            raise ImportOffsetConflictError()

        file.confirmed_offset = actual_offset
        job.uploaded_bytes = sum(item.confirmed_offset for item in job.files)
        job.updated_at = utc_now_for_storage()
        session.flush()
        response = ImportUploadProgressRead(
            file_id=file.id,
            confirmed_offset=file.confirmed_offset,
            uploaded_bytes=job.uploaded_bytes,
            total_bytes=job.total_bytes,
        )
        session.commit()
        return response
    except (
        ImportJobNotFoundError,
        ImportJobStateConflictError,
        ImportFileMismatchError,
        ImportOffsetConflictError,
    ):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def queue_job(session: Session, job_id: UUID) -> ImportJobRead:
    try:
        job = _job_or_error(session, job_id)
        if job.status != ImportJobStatus.UPLOADING.value:
            _state_conflict()
        if len(job.files) != job.total_files or any(
            item.confirmed_offset != item.size_bytes for item in job.files
        ) or job.uploaded_bytes != job.total_bytes:
            raise ImportFileMismatchError()
        job.status = ImportJobStatus.QUEUED.value
        job.updated_at = utc_now_for_storage()
        session.flush()
        response = _job_read(job)
        session.commit()
        return response
    except (
        ImportJobNotFoundError,
        ImportJobStateConflictError,
        ImportFileMismatchError,
    ):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def mark_job_running(session: Session, job_id: UUID) -> ImportJobRead:
    try:
        job = _job_or_error(session, job_id)
        if job.status != ImportJobStatus.QUEUED.value:
            _state_conflict()
        now = utc_now_for_storage()
        job.status = ImportJobStatus.RUNNING.value
        job.started_at = now
        job.updated_at = now
        session.flush()
        response = _job_read(job)
        session.commit()
        return response
    except (ImportJobNotFoundError, ImportJobStateConflictError):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def requeue_running_jobs(session: Session) -> int:
    """Return interrupted running jobs to the durable queued state."""
    try:
        jobs = session.scalars(
            select(ImportJob).where(
                ImportJob.status == ImportJobStatus.RUNNING.value,
            )
        ).all()
        now = utc_now_for_storage()
        for job in jobs:
            job.status = ImportJobStatus.QUEUED.value
            job.started_at = None
            job.updated_at = now
        session.commit()
        return len(jobs)
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def active_job_ids(session: Session) -> list[UUID]:
    """Return job directories that must survive orphan cleanup."""
    try:
        return list(
            session.scalars(
                select(ImportJob.id).where(
                    ImportJob.status.in_(
                        (
                            ImportJobStatus.UPLOADING.value,
                            ImportJobStatus.QUEUED.value,
                            ImportJobStatus.RUNNING.value,
                        )
                    )
                )
            ).all()
        )
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def claim_next_job(session: Session) -> ImportJobRead | None:
    """Claim the oldest queued job for the single in-process worker."""
    try:
        job_id = session.scalar(
            select(ImportJob.id)
            .where(ImportJob.status == ImportJobStatus.QUEUED.value)
            .order_by(ImportJob.created_at.asc(), ImportJob.id.asc())
            .limit(1)
        )
        if job_id is None:
            return None
        return mark_job_running(session, job_id)
    except PersistenceError:
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def complete_job(
    session: Session,
    job_id: UUID,
    report: ImportReport,
) -> ImportJobRead:
    try:
        job = _job_or_error(session, job_id)
        if job.status != ImportJobStatus.RUNNING.value:
            _state_conflict()
        try:
            report_value = ImportReport.model_validate(
                report.model_dump() if isinstance(report, ImportReport) else report
            )
        except ValidationError as error:
            raise ImportFileMismatchError() from error
        if report_value.total != job.total_files:
            raise ImportFileMismatchError()

        now = utc_now_for_storage()
        job.status = ImportJobStatus.COMPLETED.value
        job.report = report_value.model_dump(mode="json")
        job.error_code = None
        job.error_message = None
        job.active_slot = None
        job.completed_at = now
        job.updated_at = now
        session.flush()
        response = _job_read(job)
        session.commit()
        return response
    except (
        ImportJobNotFoundError,
        ImportJobStateConflictError,
        ImportFileMismatchError,
    ):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def _safe_failure_details(code: str, message: str) -> tuple[str, str]:
    safe_code = code if isinstance(code, str) and _SAFE_ERROR_CODE.fullmatch(code) else "import_failed"
    safe_message = message.strip() if isinstance(message, str) else ""
    if (
        not 1 <= len(safe_message) <= 512
        or any(unicodedata.category(character) == "Cc" for character in safe_message)
        or _LEAKY_MESSAGE.search(safe_message)
    ):
        safe_message = _GENERIC_FAILURE_MESSAGE
    return safe_code, safe_message


def fail_job(
    session: Session,
    job_id: UUID,
    code: str,
    message: str,
) -> ImportJobRead:
    try:
        job = _job_or_error(session, job_id)
        if job.status not in {
            ImportJobStatus.QUEUED.value,
            ImportJobStatus.RUNNING.value,
        }:
            _state_conflict()
        safe_code, safe_message = _safe_failure_details(code, message)
        now = utc_now_for_storage()
        job.status = ImportJobStatus.FAILED.value
        job.report = None
        job.error_code = safe_code
        job.error_message = safe_message
        job.active_slot = None
        job.completed_at = now
        job.updated_at = now
        session.flush()
        response = _job_read(job)
        session.commit()
        return response
    except (ImportJobNotFoundError, ImportJobStateConflictError):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def delete_job(session: Session, job_id: UUID) -> None:
    try:
        job = _job_or_error(session, job_id)
        if job.status in {
            ImportJobStatus.QUEUED.value,
            ImportJobStatus.RUNNING.value,
        }:
            _state_conflict()
        session.delete(job)
        session.commit()
    except (ImportJobNotFoundError, ImportJobStateConflictError):
        session.rollback()
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
