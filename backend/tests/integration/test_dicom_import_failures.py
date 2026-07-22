from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.instance import Instance
from app.models.study import Study
from app.schemas.patient import PatientCreate
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.managed_storage import (
    ManagedStorage,
    ManagedStorageError,
)
from app.services.patient_service import create_patient
from tests.dicom_factory import write_dicom_file


class PostWriteFailingStorage(ManagedStorage):
    def store_new(self, source: Path, target: Path):
        super().store_new(source, target)
        raise ManagedStorageError(r"D:\private\post-write failure")


def test_storage_failure_after_target_creation_leaves_no_residual(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    fixture = write_dicom_file(tmp_path / "post-write-failure.dcm")
    failing_storage = PostWriteFailingStorage(managed_storage.settings)

    report = import_dicom_files(
        db_session,
        patient.id,
        [ImportSource(fixture.path, fixture.path.name)],
        failing_storage,
    )

    assert report.failed == 1
    assert report.items[0].code == "study_import_failed"
    assert "private" not in report.items[0].message.lower()
    assert db_session.scalar(select(func.count()).select_from(Study)) == 0
    assert db_session.scalar(select(func.count()).select_from(Instance)) == 0
    assert list(failing_storage.dicom_dir.rglob("*.dcm")) == []


def test_unknown_target_conflict_preserves_existing_file(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    fixture = write_dicom_file(tmp_path / "conflict.dcm")
    from app.services.dicom_parser import parse_dicom

    parsed = parse_dicom(fixture.path, fixture.path.name)
    assert parsed.metadata is not None
    target = managed_storage.target_path(patient.id, parsed.metadata)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"existing orphan")

    report = import_dicom_files(
        db_session,
        patient.id,
        [ImportSource(fixture.path, fixture.path.name)],
        managed_storage,
    )

    assert report.failed == 1
    assert target.read_bytes() == b"existing orphan"
    assert db_session.scalar(select(func.count()).select_from(Instance)) == 0


def test_second_study_commit_failure_preserves_first_study(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
    monkeypatch,
) -> None:
    patient = create_patient(
        db_session,
        PatientCreate(medical_record_no="MR-DICOM-001", name="Teaching"),
    )
    first = write_dicom_file(tmp_path / "first-study.dcm")
    second = write_dicom_file(tmp_path / "second-study.dcm")
    real_commit = db_session.commit
    commit_count = 0

    def commit_with_second_failure() -> None:
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            raise SQLAlchemyError(r"D:\private\commit failure")
        real_commit()

    monkeypatch.setattr(db_session, "commit", commit_with_second_failure)

    report = import_dicom_files(
        db_session,
        patient.id,
        [
            ImportSource(first.path, first.path.name),
            ImportSource(second.path, second.path.name),
        ],
        managed_storage,
    )

    assert report.success == 1
    assert report.failed == 1
    assert db_session.scalar(select(func.count()).select_from(Study)) == 1
    assert db_session.scalar(select(func.count()).select_from(Instance)) == 1
    assert len(list(managed_storage.dicom_dir.rglob("*.dcm"))) == 1
