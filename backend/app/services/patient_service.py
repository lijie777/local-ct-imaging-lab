from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    ImportInProgressError,
    MedicalRecordNumberConflictError,
    PatientNotFoundError,
    PersistenceError,
)
from app.models.common import utc_now_for_storage
from app.models.patient import Patient
from app.models.import_job import ImportJob
from app.models.study import Study
from app.schemas.patient import PatientCreate, PatientPatch, PatientRead
from app.services.patient_validation import validate_patient_fields
from app.services.managed_storage import (
    ManagedStorage,
    ManagedStorageError,
    StagedPatientDirectory,
)


def create_patient(session: Session, payload: PatientCreate) -> PatientRead:
    validated = validate_patient_fields(
        medical_record_no=payload.medical_record_no,
        name=payload.name,
        sex=payload.sex,
        birth_date=payload.birth_date,
    )

    try:
        existing_id = session.scalar(
            select(Patient.id).where(
                Patient.medical_record_no_normalized
                == validated.medical_record_no_normalized
            )
        )
        if existing_id is not None:
            session.rollback()
            raise MedicalRecordNumberConflictError()

        created_at = utc_now_for_storage()
        patient = Patient(
            medical_record_no=validated.medical_record_no,
            medical_record_no_normalized=validated.medical_record_no_normalized,
            name=validated.name,
            sex=validated.sex,
            birth_date=validated.birth_date,
            created_at=created_at,
            updated_at=created_at,
        )
        session.add(patient)
        session.flush()
        session.refresh(patient)
        response = PatientRead.from_patient(patient)
        session.commit()
        return response
    except MedicalRecordNumberConflictError:
        raise
    except IntegrityError as error:
        session.rollback()
        raise MedicalRecordNumberConflictError() from error
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _patient_read(session: Session, patient: Patient) -> PatientRead:
    study_count, latest_study_date = session.execute(
        select(func.count(Study.id), func.max(Study.study_date)).where(
            Study.patient_id == patient.id
        )
    ).one()
    return PatientRead.from_patient(
        patient,
        study_count=int(study_count or 0),
        latest_study_date=latest_study_date,
    )


def list_patients(session: Session, query: str | None = None) -> list[PatientRead]:
    try:
        statement = select(Patient)
        normalized_query = "" if query is None else query.strip()
        if normalized_query:
            medical_record_pattern = (
                f"%{_escape_like(normalized_query.casefold())}%"
            )
            name_pattern = f"%{_escape_like(normalized_query.lower())}%"
            statement = statement.where(
                or_(
                    Patient.medical_record_no_normalized.like(
                        medical_record_pattern,
                        escape="\\",
                    ),
                    func.lower(Patient.name).like(name_pattern, escape="\\"),
                )
            )
        statement = statement.order_by(
            Patient.updated_at.desc(),
            Patient.medical_record_no_normalized.asc(),
        )
        patients = session.scalars(statement).all()
        return [_patient_read(session, patient) for patient in patients]
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def get_patient(session: Session, patient_id: UUID) -> PatientRead:
    try:
        patient = session.get(Patient, patient_id)
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error

    if patient is None:
        raise PatientNotFoundError()
    try:
        return _patient_read(session, patient)
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def update_patient(
    session: Session,
    patient_id: UUID,
    payload: PatientPatch,
) -> PatientRead:
    try:
        patient = session.get(Patient, patient_id)
        if patient is None:
            raise PatientNotFoundError()

        fields = payload.model_fields_set
        validated = validate_patient_fields(
            medical_record_no=(
                payload.medical_record_no
                if "medical_record_no" in fields
                else patient.medical_record_no
            ),
            name=payload.name if "name" in fields else patient.name,
            sex=payload.sex if "sex" in fields else patient.sex,
            birth_date=(
                payload.birth_date if "birth_date" in fields else patient.birth_date
            ),
        )

        existing_id = session.scalar(
            select(Patient.id).where(
                Patient.medical_record_no_normalized
                == validated.medical_record_no_normalized,
                Patient.id != patient.id,
            )
        )
        if existing_id is not None:
            session.rollback()
            raise MedicalRecordNumberConflictError()

        patient.medical_record_no = validated.medical_record_no
        patient.medical_record_no_normalized = (
            validated.medical_record_no_normalized
        )
        patient.name = validated.name
        patient.sex = validated.sex
        patient.birth_date = validated.birth_date
        patient.updated_at = utc_now_for_storage()
        session.flush()
        session.refresh(patient)
        response = _patient_read(session, patient)
        session.commit()
        return response
    except (PatientNotFoundError, MedicalRecordNumberConflictError):
        raise
    except IntegrityError as error:
        session.rollback()
        raise MedicalRecordNumberConflictError() from error
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def delete_patient(
    session: Session,
    patient_id: UUID,
    storage: ManagedStorage,
) -> None:
    try:
        patient = session.get(Patient, patient_id)
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
    if patient is None:
        raise PatientNotFoundError()

    try:
        active_import = session.scalar(
            select(ImportJob.id).where(
                ImportJob.patient_id == patient_id,
                ImportJob.active_slot == 1,
            )
        )
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
    if active_import is not None:
        raise ImportInProgressError()

    staged: StagedPatientDirectory | None = None
    try:
        staged = storage.stage_patient_delete(patient_id)
        session.delete(patient)
        session.commit()
    except (SQLAlchemyError, ManagedStorageError, OSError) as error:
        session.rollback()
        if staged is not None:
            try:
                storage.restore_patient_delete(staged)
            except (ManagedStorageError, OSError):
                pass
        raise PersistenceError() from error

    assert staged is not None
    try:
        storage.purge_patient_delete(staged)
    except (ManagedStorageError, OSError) as error:
        # Purging may already have removed part of the staged directory. Keep
        # the committed database deletion so no restored row can reference a
        # missing DICOM file; any remainder stays staged for cleanup retry.
        session.rollback()
        raise PersistenceError() from error
