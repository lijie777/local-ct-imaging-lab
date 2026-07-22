from __future__ import annotations

from pathlib import Path

from pydicom import dcmread
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.instance import Instance
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study
from app.schemas.patient import PatientCreate
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.managed_storage import ManagedStorage
from app.services.patient_service import create_patient
from tests.dicom_factory import write_dicom_file


def _remove_dicom_attribute(path: Path, name: str) -> None:
    dataset = dcmread(path)
    delattr(dataset, name)
    dataset.save_as(path, enforce_file_format=True)


def _replace_dicom_attribute(path: Path, name: str, value) -> None:
    dataset = dcmread(path)
    setattr(dataset, name, value)
    dataset.save_as(path, enforce_file_format=True)


def test_imports_one_study_with_multiple_series_and_managed_files(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="  MR-DICOM-001  ", name="Teaching"),
    )
    study_uid = "1.2.826.0.1.3680043.10.100.1"
    first_series_uid = "1.2.826.0.1.3680043.10.100.2"
    second_series_uid = "1.2.826.0.1.3680043.10.100.3"
    fixtures = [
        write_dicom_file(
            tmp_path / "a-1.dcm",
            study_uid=study_uid,
            series_uid=first_series_uid,
            instance_number=1,
        ),
        write_dicom_file(
            tmp_path / "a-2.dcm",
            study_uid=study_uid,
            series_uid=first_series_uid,
            instance_number=2,
        ),
        write_dicom_file(
            tmp_path / "b-1.dcm",
            study_uid=study_uid,
            series_uid=second_series_uid,
            instance_number=1,
        ),
    ]

    report = import_dicom_files(
        db_session,
        patient.id,
        [ImportSource(item.path, item.path.name) for item in fixtures],
        managed_storage,
    )

    assert report.total == 3
    assert report.success == 3
    assert report.duplicate == report.skipped == report.unsupported == report.failed == 0
    assert db_session.scalar(select(func.count()).select_from(Study)) == 1
    assert db_session.scalar(select(func.count()).select_from(Series)) == 2
    assert db_session.scalar(select(func.count()).select_from(Instance)) == 3
    stored_instances = db_session.scalars(select(Instance)).all()
    assert all(not Path(item.managed_path).is_absolute() for item in stored_instances)
    assert all(
        (managed_storage.data_dir / item.managed_path).is_file()
        for item in stored_instances
    )


def test_imported_study_remains_after_new_engine_and_session(
    tmp_path: Path,
    database_url: str,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    from app.db.session import create_database

    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    fixture = write_dicom_file(tmp_path / "restart.dcm")
    report = import_dicom_files(
        db_session,
        patient.id,
        [ImportSource(fixture.path, fixture.path.name)],
        managed_storage,
    )
    assert report.success == 1

    restarted = create_database(database_url)
    try:
        with restarted.session_factory() as restarted_session:
            assert restarted_session.scalar(select(func.count()).select_from(Patient)) == 1
            assert restarted_session.scalar(select(func.count()).select_from(Study)) == 1
            assert restarted_session.scalar(select(func.count()).select_from(Series)) == 1
            assert restarted_session.scalar(select(func.count()).select_from(Instance)) == 1
    finally:
        restarted.engine.dispose()


def test_mixed_import_reports_every_file_in_original_order(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    valid = write_dicom_file(tmp_path / "01-valid.dcm")
    duplicate = write_dicom_file(
        tmp_path / "02-duplicate.dcm",
        study_uid=valid.study_uid,
        series_uid=valid.series_uid,
        sop_uid=valid.sop_uid,
        instance_number=2,
    )
    non_dicom = tmp_path / "03-not-dicom.txt"
    non_dicom.write_text("not dicom", encoding="utf-8")
    damaged = tmp_path / "04-damaged.dcm"
    damaged.write_bytes((b"\0" * 128) + b"DICM" + b"damaged")
    non_ct = write_dicom_file(tmp_path / "05-mr.dcm", modality="MR")
    missing_patient = write_dicom_file(tmp_path / "06-missing-patient.dcm")
    _remove_dicom_attribute(missing_patient.path, "PatientID")
    missing_uid = write_dicom_file(tmp_path / "07-missing-uid.dcm")
    _remove_dicom_attribute(missing_uid.path, "SOPInstanceUID")
    unsupported = write_dicom_file(
        tmp_path / "08-unsupported.dcm",
        include_geometry=False,
    )
    mismatch = write_dicom_file(
        tmp_path / "09-mismatch.dcm",
        patient_id="OTHER-PATIENT",
    )
    paths = [
        valid.path,
        duplicate.path,
        non_dicom,
        damaged,
        non_ct.path,
        missing_patient.path,
        missing_uid.path,
        unsupported.path,
        mismatch.path,
    ]

    report = import_dicom_files(
        db_session,
        patient.id,
        [ImportSource(path, path.name) for path in paths],
        managed_storage,
    )

    assert [item.file_name for item in report.items] == [path.name for path in paths]
    assert [item.category.value for item in report.items] == [
        "success",
        "duplicate",
        "skipped",
        "failed",
        "skipped",
        "skipped",
        "failed",
        "unsupported",
        "skipped",
    ]
    assert (
        report.success,
        report.duplicate,
        report.skipped,
        report.unsupported,
        report.failed,
    ) == (1, 1, 4, 1, 2)
    assert report.total == len(report.items) == 9
    assert all(item.code and item.message for item in report.items)


def test_series_orientation_within_tolerance_remains_eligible(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    first = write_dicom_file(tmp_path / "orientation-1.dcm", instance_number=1)
    second = write_dicom_file(
        tmp_path / "orientation-2.dcm",
        study_uid=first.study_uid,
        series_uid=first.series_uid,
        instance_number=2,
    )
    _replace_dicom_attribute(
        second.path,
        "ImageOrientationPatient",
        [1.0, 0.000001, 0.0, 0.0, 1.0, 0.0],
    )

    report = import_dicom_files(
        db_session,
        patient.id,
        [
            ImportSource(first.path, first.path.name),
            ImportSource(second.path, second.path.name),
        ],
        managed_storage,
    )

    assert report.success == 2
    series = db_session.scalar(select(Series))
    assert series is not None
    assert series.viewability_status == "eligible"
    assert series.viewability_reason is None


def test_series_orientation_outside_tolerance_is_marked_unsupported(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    first = write_dicom_file(tmp_path / "orientation-1.dcm", instance_number=1)
    second = write_dicom_file(
        tmp_path / "orientation-2.dcm",
        study_uid=first.study_uid,
        series_uid=first.series_uid,
        instance_number=2,
    )
    _replace_dicom_attribute(
        second.path,
        "ImageOrientationPatient",
        [1.0, 0.0000011, 0.0, 0.0, 1.0, 0.0],
    )

    report = import_dicom_files(
        db_session,
        patient.id,
        [
            ImportSource(first.path, first.path.name),
            ImportSource(second.path, second.path.name),
        ],
        managed_storage,
    )

    assert report.success == 2
    series = db_session.scalar(select(Series))
    assert series is not None
    assert series.viewability_status == "unsupported"
    assert series.viewability_reason == "inconsistent_orientation"
