from __future__ import annotations

from pathlib import Path

from pydicom import dcmread
from pydicom.uid import JPEG2000Lossless

from app.services.dicom_parser import ParseCategory, parse_dicom
from tests.dicom_factory import write_dicom_file


def test_parses_valid_ct_without_accessing_pixel_value(tmp_path: Path) -> None:
    fixture = write_dicom_file(tmp_path / "valid.dcm", instance_number=7)

    result = parse_dicom(fixture.path, "folder/valid.dcm")

    assert result.category is ParseCategory.CANDIDATE
    assert result.code == "eligible_ct"
    assert result.display_name == "folder/valid.dcm"
    assert result.metadata is not None
    assert result.metadata.patient_id == "MR-DICOM-001"
    assert result.metadata.study_instance_uid == fixture.study_uid
    assert result.metadata.series_instance_uid == fixture.series_uid
    assert result.metadata.sop_instance_uid == fixture.sop_uid
    assert result.metadata.instance_number == 7
    assert result.metadata.image_position_patient == (0.0, 0.0, 6.0)
    assert result.metadata.image_orientation_patient == (
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
    )


def test_skips_non_dicom_file(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("not a dicom file", encoding="utf-8")

    result = parse_dicom(path, path.name)

    assert result.category is ParseCategory.SKIPPED
    assert result.code == "non_dicom"


def test_reports_damaged_dicom_with_preamble_as_failed(tmp_path: Path) -> None:
    path = tmp_path / "damaged.dcm"
    path.write_bytes((b"\0" * 128) + b"DICM" + b"broken")

    result = parse_dicom(path, path.name)

    assert result.category is ParseCategory.FAILED
    assert result.code == "damaged_dicom"


def test_skips_non_ct_modality(tmp_path: Path) -> None:
    fixture = write_dicom_file(tmp_path / "mr.dcm", modality="MR")

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.SKIPPED
    assert result.code == "non_ct_modality"


def test_skips_missing_patient_id(tmp_path: Path) -> None:
    fixture = write_dicom_file(tmp_path / "missing-patient.dcm")
    dataset = dcmread(fixture.path)
    del dataset.PatientID
    dataset.save_as(fixture.path, enforce_file_format=True)

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.SKIPPED
    assert result.code == "missing_patient_id"


def test_fails_when_required_uid_is_missing(tmp_path: Path) -> None:
    fixture = write_dicom_file(tmp_path / "missing-uid.dcm")
    dataset = dcmread(fixture.path)
    del dataset.SeriesInstanceUID
    dataset.save_as(fixture.path, enforce_file_format=True)

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.FAILED
    assert result.code == "missing_series_instance_uid"


def test_marks_unsupported_transfer_syntax_without_decoding_pixels(
    tmp_path: Path,
) -> None:
    fixture = write_dicom_file(
        tmp_path / "compressed.dcm",
        transfer_syntax_uid=JPEG2000Lossless,
        include_pixel_data=False,
    )

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.UNSUPPORTED
    assert result.code == "unsupported_transfer_syntax"
    assert result.metadata is not None
    assert result.metadata.viewability_reason == "unsupported_transfer_syntax"


def test_marks_missing_geometry_as_unsupported(tmp_path: Path) -> None:
    fixture = write_dicom_file(
        tmp_path / "missing-geometry.dcm",
        include_geometry=False,
    )

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.UNSUPPORTED
    assert result.code == "missing_geometry"
    assert result.metadata is not None


def test_marks_missing_pixel_data_as_unsupported(tmp_path: Path) -> None:
    fixture = write_dicom_file(
        tmp_path / "missing-pixels.dcm",
        include_pixel_data=False,
    )

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.category is ParseCategory.UNSUPPORTED
    assert result.code == "missing_pixel_data"


def test_preserves_safe_optional_metadata_and_dates(tmp_path: Path) -> None:
    fixture = write_dicom_file(tmp_path / "metadata.dcm")

    result = parse_dicom(fixture.path, fixture.path.name)

    assert result.metadata is not None
    assert result.metadata.study_date.isoformat() == "2026-07-20"
    assert result.metadata.study_time.isoformat() == "09:30:00"
    assert result.metadata.accession_number == "ACC-TEACHING"
    assert result.metadata.study_description == "De-identified teaching CT"
    assert result.metadata.series_description == "Axial teaching series"
    assert result.metadata.body_part_examined == "CHEST"
