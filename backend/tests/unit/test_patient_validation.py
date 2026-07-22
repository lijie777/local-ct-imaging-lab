from __future__ import annotations

from datetime import date, timedelta
from importlib import import_module
from typing import Any

import pytest


TODAY = date(2026, 7, 17)


def _validation_module() -> Any:
    return import_module("app.services.patient_validation")


def _valid_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "medical_record_no": "MR-0001",
        "name": "演示病人",
        "sex": "unknown",
        "birth_date": date(1990, 1, 2),
        "today": TODAY,
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("medical_record_no", ""),
        ("medical_record_no", "   "),
        ("name", ""),
        ("name", "   "),
    ],
)
def test_required_text_fields_are_rejected(field: str, value: str) -> None:
    validation = _validation_module()

    with pytest.raises(validation.PatientValidationError) as error:
        validation.validate_patient_fields(**_valid_payload(**{field: value}))

    assert error.value.field == field
    assert error.value.code == "required"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("medical_record_no", "M" * 65),
        ("name", "姓" * 101),
    ],
)
def test_text_fields_enforce_maximum_length(field: str, value: str) -> None:
    validation = _validation_module()

    with pytest.raises(validation.PatientValidationError) as error:
        validation.validate_patient_fields(**_valid_payload(**{field: value}))

    assert error.value.field == field
    assert error.value.code == "too_long"


@pytest.mark.parametrize("field", ["medical_record_no", "name"])
@pytest.mark.parametrize("control", ["\n", "\r", "\t", "\x00"])
def test_text_fields_reject_newlines_and_control_characters(
    field: str,
    control: str,
) -> None:
    validation = _validation_module()

    with pytest.raises(validation.PatientValidationError) as error:
        validation.validate_patient_fields(
            **_valid_payload(**{field: f"有效{control}文本"})
        )

    assert error.value.field == field
    assert error.value.code == "not_visible"


def test_outer_whitespace_is_trimmed_without_changing_internal_format() -> None:
    validation = _validation_module()

    result = validation.validate_patient_fields(
        **_valid_payload(
            medical_record_no="  MR 01/A-2  ",
            name="  Anne-Marie  O'Neil（演示）  ",
        )
    )

    assert result.medical_record_no == "MR 01/A-2"
    assert result.medical_record_no_normalized == "mr 01/a-2"
    assert result.name == "Anne-Marie  O'Neil（演示）"


def test_medical_record_number_uses_casefold_equivalence() -> None:
    validation = _validation_module()

    first = validation.validate_patient_fields(
        **_valid_payload(medical_record_no=" Straße-01 ")
    )
    second = validation.validate_patient_fields(
        **_valid_payload(medical_record_no="STRASSE-01")
    )

    assert first.medical_record_no_normalized == "strasse-01"
    assert second.medical_record_no_normalized == first.medical_record_no_normalized


@pytest.mark.parametrize("sex", ["male", "female", "other", "unknown"])
def test_allowed_sex_values_are_preserved(sex: str) -> None:
    validation = _validation_module()

    result = validation.validate_patient_fields(**_valid_payload(sex=sex))

    assert result.sex == sex


def test_missing_sex_defaults_to_unknown() -> None:
    validation = _validation_module()

    result = validation.validate_patient_fields(**_valid_payload(sex=None))

    assert result.sex == "unknown"


def test_invalid_sex_is_rejected() -> None:
    validation = _validation_module()

    with pytest.raises(validation.PatientValidationError) as error:
        validation.validate_patient_fields(**_valid_payload(sex="unspecified"))

    assert error.value.field == "sex"
    assert error.value.code == "invalid_choice"


@pytest.mark.parametrize("birth_date", [None, date.min, TODAY])
def test_any_valid_date_not_later_than_today_is_accepted(
    birth_date: date | None,
) -> None:
    validation = _validation_module()

    result = validation.validate_patient_fields(
        **_valid_payload(birth_date=birth_date)
    )

    assert result.birth_date == birth_date


def test_future_birth_date_is_rejected() -> None:
    validation = _validation_module()

    with pytest.raises(validation.PatientValidationError) as error:
        validation.validate_patient_fields(
            **_valid_payload(birth_date=TODAY + timedelta(days=1))
        )

    assert error.value.field == "birth_date"
    assert error.value.code == "date_in_future"


@pytest.mark.parametrize("workflow", ["create", "edit"])
def test_create_and_edit_share_the_complete_field_validation_matrix(
    workflow: str,
) -> None:
    validation = _validation_module()
    invalid_values = {
        "medical_record_no": "\n",
        "name": "\x00",
        "sex": "invalid",
        "birth_date": TODAY + timedelta(days=1),
    }

    for field, value in invalid_values.items():
        with pytest.raises(validation.PatientValidationError) as error:
            validation.validate_patient_fields(
                **_valid_payload(**{field: value})
            )
        assert error.value.field == field, f"{workflow} must validate {field}"
