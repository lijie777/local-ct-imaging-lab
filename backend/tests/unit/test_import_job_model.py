from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.import_job import ImportJob, ImportJobFile
from app.models.patient import Patient


NOW = datetime(2026, 7, 23, 12, 0, 0)


def _patient() -> Patient:
    return Patient(
        medical_record_no="MR-IMPORT-JOB",
        medical_record_no_normalized="mr-import-job",
        name="导入任务测试病人",
        sex="unknown",
        created_at=NOW,
        updated_at=NOW,
    )


def _job(patient: Patient, **overrides: Any) -> ImportJob:
    values: dict[str, Any] = {
        "patient": patient,
        "status": "uploading",
        "active_slot": 1,
        "total_files": 1,
        "total_bytes": 10,
        "uploaded_bytes": 0,
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(overrides)
    return ImportJob(**values)


def _file(job: ImportJob, **overrides: Any) -> ImportJobFile:
    values: dict[str, Any] = {
        "job": job,
        "ordinal": 0,
        "relative_path": "series/image-001.dcm",
        "size_bytes": 10,
        "last_modified_ms": 1_721_736_000_000,
        "resume_fingerprint": "a" * 64,
        "confirmed_offset": 0,
    }
    values.update(overrides)
    return ImportJobFile(**values)


@pytest.mark.parametrize(
    "overrides",
    [
        {"status": "paused"},
        {"status": "uploading", "active_slot": None},
        {"status": "completed", "active_slot": 1, "completed_at": NOW},
        {"total_files": 0},
        {"total_files": 2_001},
        {"total_bytes": 0},
        {"total_bytes": 8 * 1024**3 + 1},
        {"uploaded_bytes": -1},
        {"uploaded_bytes": 11},
        {"updated_at": datetime(2026, 7, 23, 11, 59, 59)},
        {"started_at": datetime(2026, 7, 23, 11, 59, 59)},
        {"started_at": datetime(2026, 7, 23, 12, 0, 1)},
        {
            "status": "completed",
            "active_slot": None,
            "completed_at": datetime(2026, 7, 23, 11, 59, 59),
        },
        {
            "status": "completed",
            "active_slot": None,
            "completed_at": datetime(2026, 7, 23, 12, 0, 1),
        },
        {"status": "uploading", "completed_at": NOW},
        {"status": "completed", "active_slot": None, "completed_at": None},
    ],
)
def test_import_job_database_checks_reject_invalid_state(
    db_session: Session,
    overrides: dict[str, Any],
) -> None:
    patient = _patient()
    db_session.add(_job(patient, **overrides))

    with pytest.raises(IntegrityError):
        db_session.commit()


@pytest.mark.parametrize(
    "overrides",
    [
        {"ordinal": -1},
        {"ordinal": 2_000},
        {"size_bytes": 0},
        {"size_bytes": 512 * 1024**2 + 1},
        {"last_modified_ms": -1},
        {"confirmed_offset": -1},
        {"confirmed_offset": 11},
    ],
)
def test_import_job_file_database_checks_reject_invalid_progress(
    db_session: Session,
    overrides: dict[str, Any],
) -> None:
    job = _job(_patient())
    job.files.append(_file(job, **overrides))
    db_session.add(job)

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_each_patient_has_at_most_one_active_job(db_session: Session) -> None:
    patient = _patient()
    db_session.add_all([_job(patient), _job(patient, total_bytes=20)])

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_terminal_jobs_can_share_null_active_slot(db_session: Session) -> None:
    patient = _patient()
    db_session.add_all(
        [
            _job(
                patient,
                status="completed",
                active_slot=None,
                uploaded_bytes=10,
                completed_at=NOW,
            ),
            _job(
                patient,
                status="failed",
                active_slot=None,
                completed_at=NOW,
            ),
        ]
    )

    db_session.commit()

    assert db_session.scalar(select(func.count()).select_from(ImportJob)) == 2


@pytest.mark.parametrize(
    ("first_overrides", "second_overrides"),
    [
        ({}, {"relative_path": "series/image-002.dcm"}),
        ({}, {"ordinal": 1}),
    ],
)
def test_job_file_ordinal_and_relative_path_are_independently_unique(
    db_session: Session,
    first_overrides: dict[str, Any],
    second_overrides: dict[str, Any],
) -> None:
    job = _job(_patient(), total_files=2, total_bytes=20)
    job.files.extend(
        [
            _file(job, **first_overrides),
            _file(job, **second_overrides),
        ]
    )
    db_session.add(job)

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_deleting_patient_cascades_jobs_and_files(db_session: Session) -> None:
    patient = _patient()
    job = _job(patient)
    job.files.append(_file(job))
    db_session.add(patient)
    db_session.commit()
    patient_id = patient.id

    db_session.execute(delete(Patient).where(Patient.id == patient_id))
    db_session.commit()

    assert db_session.scalar(select(func.count()).select_from(ImportJob)) == 0
    assert db_session.scalar(select(func.count()).select_from(ImportJobFile)) == 0


def test_deleting_job_cascades_files(db_session: Session) -> None:
    job = _job(_patient())
    job.files.append(_file(job))
    db_session.add(job)
    db_session.commit()
    job_id = job.id

    db_session.execute(delete(ImportJob).where(ImportJob.id == job_id))
    db_session.commit()

    assert db_session.scalar(select(func.count()).select_from(ImportJobFile)) == 0


def test_import_job_bounds_accept_maximum_and_complete_offset(
    db_session: Session,
) -> None:
    job = _job(_patient(), total_files=2_000)
    job.files.append(
        _file(
            job,
            ordinal=1_999,
            confirmed_offset=10,
        )
    )
    db_session.add(job)

    db_session.commit()

    assert job.total_files == 2_000
    assert job.files[0].ordinal == 1_999
    assert job.files[0].confirmed_offset == job.files[0].size_bytes
