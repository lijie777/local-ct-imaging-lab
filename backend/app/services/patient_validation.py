from __future__ import annotations

from dataclasses import dataclass
from datetime import date


ALLOWED_SEX_VALUES = frozenset({"male", "female", "other", "unknown"})


class PatientValidationError(ValueError):
    def __init__(self, *, field: str, code: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class ValidatedPatientFields:
    medical_record_no: str
    medical_record_no_normalized: str
    name: str
    sex: str
    birth_date: date | None


def _validate_visible_text(
    value: str,
    *,
    field: str,
    maximum_length: int,
) -> str:
    normalized = value.strip()
    if not normalized:
        raise PatientValidationError(
            field=field,
            code="required",
            message="此字段为必填项",
        )
    if len(normalized) > maximum_length:
        raise PatientValidationError(
            field=field,
            code="too_long",
            message=f"此字段最多允许 {maximum_length} 个字符",
        )
    if not normalized.isprintable():
        raise PatientValidationError(
            field=field,
            code="not_visible",
            message="此字段不得包含换行符或其他控制字符",
        )
    return normalized


def validate_patient_fields(
    *,
    medical_record_no: str,
    name: str,
    sex: str | None = None,
    birth_date: date | None = None,
    today: date | None = None,
) -> ValidatedPatientFields:
    validated_medical_record_no = _validate_visible_text(
        medical_record_no,
        field="medical_record_no",
        maximum_length=64,
    )
    validated_name = _validate_visible_text(
        name,
        field="name",
        maximum_length=100,
    )

    validated_sex = "unknown" if sex is None else sex
    if validated_sex not in ALLOWED_SEX_VALUES:
        raise PatientValidationError(
            field="sex",
            code="invalid_choice",
            message="性别选项无效",
        )

    current_date = today or date.today()
    if birth_date is not None and birth_date > current_date:
        raise PatientValidationError(
            field="birth_date",
            code="date_in_future",
            message="出生日期不得晚于今天",
        )

    return ValidatedPatientFields(
        medical_record_no=validated_medical_record_no,
        medical_record_no_normalized=validated_medical_record_no.casefold(),
        name=validated_name,
        sex=validated_sex,
        birth_date=birth_date,
    )
