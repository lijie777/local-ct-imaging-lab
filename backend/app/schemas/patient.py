from __future__ import annotations

from datetime import date, datetime, timezone
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.patient import Patient


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    UNKNOWN = "unknown"


class PatientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    medical_record_no: str = Field(
        min_length=1,
        max_length=64,
        description=(
            "Display value after trimming outer whitespace; internal spaces and "
            "symbols are preserved"
        ),
    )
    name: str = Field(min_length=1, max_length=100)
    sex: Sex = Sex.UNKNOWN
    birth_date: date | None = None


class PatientPatch(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"minProperties": 1},
    )

    medical_record_no: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sex: Sex | None = None
    birth_date: date | None = None

    @model_validator(mode="after")
    def validate_partial_update(self) -> PatientPatch:
        if not self.model_fields_set:
            raise ValueError("At least one editable field is required")
        for field in ("medical_record_no", "name", "sex"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PatientRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID = Field(
        json_schema_extra={"readOnly": True},
        description=(
            "Internal identifier returned for API operations; the UI must not "
            "display it"
        ),
    )
    medical_record_no: str
    name: str
    sex: Sex
    birth_date: date | None
    study_count: int = Field(ge=0, json_schema_extra={"readOnly": True})
    latest_study_date: date | None = Field(json_schema_extra={"readOnly": True})
    created_at: datetime = Field(
        json_schema_extra={"readOnly": True},
        description="RFC 3339 UTC timestamp ending in Z",
    )
    updated_at: datetime = Field(
        json_schema_extra={"readOnly": True},
        description="RFC 3339 UTC timestamp ending in Z",
    )

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def restore_utc_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @classmethod
    def from_patient(
        cls,
        patient: Patient,
        *,
        study_count: int = 0,
        latest_study_date: date | None = None,
    ) -> PatientRead:
        return cls.model_validate(
            {
                "id": patient.id,
                "medical_record_no": patient.medical_record_no,
                "name": patient.name,
                "sex": patient.sex,
                "birth_date": patient.birth_date,
                "study_count": study_count,
                "latest_study_date": latest_study_date,
                "created_at": patient.created_at,
                "updated_at": patient.updated_at,
            }
        )
