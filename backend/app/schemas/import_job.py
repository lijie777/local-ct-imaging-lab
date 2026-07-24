from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.dicom_import import ImportReport


class ImportJobStatus(StrEnum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ImportManifestFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relative_path: str = Field(min_length=1, max_length=1024)
    size_bytes: int = Field(ge=1, le=512 * 1024 * 1024)
    last_modified_ms: int = Field(ge=0)
    resume_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class ImportJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: list[ImportManifestFile] = Field(min_length=1, max_length=2000)


class ImportJobFileRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    ordinal: int = Field(ge=0, le=1999)
    relative_path: str = Field(min_length=1, max_length=1024)
    size_bytes: int = Field(ge=1, le=512 * 1024 * 1024)
    last_modified_ms: int = Field(ge=0)
    resume_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed_offset: int = Field(ge=0)


class ImportJobRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    patient_id: UUID
    status: ImportJobStatus
    total_files: int = Field(ge=1, le=2000)
    total_bytes: int = Field(ge=1, le=8 * 1024**3)
    uploaded_bytes: int = Field(ge=0)
    files: list[ImportJobFileRead] = Field(min_length=1, max_length=2000)
    report: ImportReport | None = None
    error_code: str | None = Field(default=None, max_length=64)
    error_message: str | None = Field(default=None, max_length=512)
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None

    @field_validator("created_at", "updated_at", "started_at", "completed_at", mode="before")
    @classmethod
    def restore_utc_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class ImportUploadProgressRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_id: UUID
    confirmed_offset: int = Field(ge=0)
    uploaded_bytes: int = Field(ge=0)
    total_bytes: int = Field(ge=1, le=8 * 1024**3)
