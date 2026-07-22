from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import PersistenceError
from app.db.session import create_database
from app.models.instance import Instance
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study
from app.schemas.patient import PatientCreate
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.managed_storage import (
    ManagedStorage,
    ManagedStorageError,
    StagedPatientDirectory,
)
from app.services.patient_service import create_patient, delete_patient
from tests.dicom_factory import write_dicom_file


class StageFailingStorage(ManagedStorage):
    def stage_patient_delete(self, patient_id):
        raise ManagedStorageError(r"D:\private\stage failure")


class PurgeFailingStorage(ManagedStorage):
    def purge_patient_delete(self, staged: StagedPatientDirectory) -> None:
        raise ManagedStorageError(r"D:\private\purge failure")


class PartialPurgeFailingStorage(ManagedStorage):
    failed_staged_delete: StagedPatientDirectory | None = None

    def purge_patient_delete(self, staged: StagedPatientDirectory) -> None:
        self.failed_staged_delete = staged
        assert staged.staged_path is not None
        first_file = next(
            path for path in staged.staged_path.rglob("*") if path.is_file()
        )
        first_file.unlink()
        raise ManagedStorageError(r"D:\private\partial purge failure")


def _import_patient_fixture(
    tmp_path: Path,
    session: Session,
    storage: ManagedStorage,
    *,
    suffix: str,
):
    medical_record_no = f"MR-DICOM-{suffix}"
    patient = create_patient(
        session,
        PatientCreate(medical_record_no=medical_record_no, name=f"Patient {suffix}"),
    )
    fixture = write_dicom_file(
        tmp_path / f"{suffix}.dcm",
        patient_id=medical_record_no,
    )
    report = import_dicom_files(
        session,
        patient.id,
        [ImportSource(fixture.path, fixture.path.name)],
        storage,
    )
    assert report.success == 1
    return patient


def _counts(session: Session) -> tuple[int, int, int, int]:
    return tuple(
        int(session.scalar(select(func.count()).select_from(model)) or 0)
        for model in (Patient, Study, Series, Instance)
    )


def test_delete_cascades_indexes_and_removes_managed_directory(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="DELETE",
    )
    patient_directory = managed_storage.patient_directory(patient.id)
    assert patient_directory.is_dir()

    delete_patient(db_session, patient.id, managed_storage)

    assert _counts(db_session) == (0, 0, 0, 0)
    assert not patient_directory.exists()


def test_stage_failure_keeps_database_and_files(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="STAGE",
    )
    failing_storage = StageFailingStorage(managed_storage.settings)

    with pytest.raises(PersistenceError):
        delete_patient(db_session, patient.id, failing_storage)

    assert _counts(db_session) == (1, 1, 1, 1)
    assert managed_storage.patient_directory(patient.id).is_dir()


def test_commit_failure_restores_staged_directory(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="COMMIT",
    )

    def fail_commit() -> None:
        raise SQLAlchemyError(r"D:\private\delete commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(PersistenceError):
        delete_patient(db_session, patient.id, managed_storage)

    assert _counts(db_session) == (1, 1, 1, 1)
    assert managed_storage.patient_directory(patient.id).is_dir()


def test_purge_failure_keeps_database_deleted_and_files_staged(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="PURGE",
    )
    failing_storage = PurgeFailingStorage(managed_storage.settings)

    with pytest.raises(PersistenceError):
        delete_patient(db_session, patient.id, failing_storage)

    assert _counts(db_session) == (0, 0, 0, 0)
    assert not managed_storage.patient_directory(patient.id).exists()
    assert any(managed_storage.delete_staging_dir.iterdir())


def test_partial_purge_failure_does_not_restore_dangling_database_rows(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="PARTIAL-PURGE",
    )
    failing_storage = PartialPurgeFailingStorage(managed_storage.settings)

    with pytest.raises(PersistenceError):
        delete_patient(db_session, patient.id, failing_storage)

    assert _counts(db_session) == (0, 0, 0, 0)
    assert not managed_storage.patient_directory(patient.id).exists()
    assert failing_storage.failed_staged_delete is not None
    assert failing_storage.failed_staged_delete.staged_path is not None
    assert failing_storage.failed_staged_delete.staged_path.exists()

    managed_storage.purge_patient_delete(failing_storage.failed_staged_delete)
    assert not failing_storage.failed_staged_delete.staged_path.exists()


def test_delete_isolated_patient_keeps_other_patient_data(
    tmp_path: Path,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    deleted = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="FIRST",
    )
    kept = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="SECOND",
    )

    delete_patient(db_session, deleted.id, managed_storage)

    assert _counts(db_session) == (1, 1, 1, 1)
    assert db_session.get(Patient, kept.id) is not None
    assert managed_storage.patient_directory(kept.id).is_dir()


def test_successful_dicom_delete_does_not_return_after_restart(
    tmp_path: Path,
    database_url: str,
    db_session: Session,
    managed_storage: ManagedStorage,
) -> None:
    patient = _import_patient_fixture(
        tmp_path,
        db_session,
        managed_storage,
        suffix="RESTART",
    )

    delete_patient(db_session, patient.id, managed_storage)

    restarted = create_database(database_url)
    try:
        with restarted.session_factory() as restarted_session:
            assert _counts(restarted_session) == (0, 0, 0, 0)
    finally:
        restarted.engine.dispose()
    assert not managed_storage.patient_directory(patient.id).exists()
