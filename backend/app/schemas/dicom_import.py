from __future__ import annotations

from datetime import date, datetime, time, timezone
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ImportCategory(StrEnum):
    SUCCESS = "success"
    DUPLICATE = "duplicate"
    SKIPPED = "skipped"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


class ImportItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str
    category: ImportCategory
    code: str
    message: str
    study_instance_uid: str | None = None
    series_instance_uid: str | None = None
    sop_instance_uid: str | None = None


class ImportReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=1)
    success: int = Field(ge=0)
    duplicate: int = Field(ge=0)
    skipped: int = Field(ge=0)
    unsupported: int = Field(ge=0)
    failed: int = Field(ge=0)
    items: list[ImportItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_accounting(self) -> ImportReport:
        counted = (
            self.success
            + self.duplicate
            + self.skipped
            + self.unsupported
            + self.failed
        )
        if counted != self.total or len(self.items) != self.total:
            raise ValueError("Import category counts must equal total and item count")
        return self


class ViewabilityStatus(StrEnum):
    ELIGIBLE = "eligible"
    UNSUPPORTED = "unsupported"


class InstanceRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    sop_instance_uid: str
    sop_class_uid: str
    transfer_syntax_uid: str
    instance_number: int | None
    image_position_patient: tuple[float, float, float] | None
    image_orientation_patient: tuple[float, float, float, float, float, float] | None
    rows: int | None
    columns: int | None


class SeriesRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    series_instance_uid: str
    modality: str
    series_number: int | None
    description: str | None
    body_part_examined: str | None
    rows: int | None
    columns: int | None
    instance_count: int = Field(ge=0)
    viewability_status: ViewabilityStatus
    viewability_reason: str | None


class SeriesDetailRead(SeriesRead):
    instances: list[InstanceRead]


class StudyRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    study_instance_uid: str
    dicom_patient_id: str
    study_date: date | None
    study_time: time | None
    accession_number: str | None
    description: str | None
    series_count: int = Field(ge=0)
    instance_count: int = Field(ge=0)
    created_at: datetime

    @field_validator("created_at", mode="before")
    @classmethod
    def restore_utc_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
