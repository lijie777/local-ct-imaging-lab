from __future__ import annotations

import json
import math
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    PatientNotFoundError,
    PersistenceError,
    SeriesNotFoundError,
    StudyNotFoundError,
)
from app.models.instance import Instance
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study
from app.schemas.dicom_import import (
    InstanceRead,
    SeriesDetailRead,
    SeriesRead,
    StudyRead,
)


def _vector(value: str | None, length: int) -> tuple[float, ...] | None:
    if value is None:
        return None
    try:
        result = tuple(float(item) for item in json.loads(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if len(result) != length or not all(math.isfinite(item) for item in result):
        return None
    return result


def _instance_read(instance: Instance) -> InstanceRead:
    return InstanceRead(
        id=instance.id,
        sop_instance_uid=instance.sop_instance_uid,
        sop_class_uid=instance.sop_class_uid,
        transfer_syntax_uid=instance.transfer_syntax_uid,
        instance_number=instance.instance_number,
        image_position_patient=_vector(instance.image_position_patient, 3),
        image_orientation_patient=_vector(instance.image_orientation_patient, 6),
        rows=instance.rows,
        columns=instance.columns,
    )


def _normal(orientation: tuple[float, ...]) -> tuple[float, float, float]:
    row = orientation[:3]
    column = orientation[3:]
    return (
        row[1] * column[2] - row[2] * column[1],
        row[2] * column[0] - row[0] * column[2],
        row[0] * column[1] - row[1] * column[0],
    )


def _ordered_instances(instances: list[Instance]) -> list[Instance]:
    orientations = [_vector(item.image_orientation_patient, 6) for item in instances]
    positions = [_vector(item.image_position_patient, 3) for item in instances]
    use_spatial = bool(instances) and all(item is not None for item in orientations) and all(
        item is not None for item in positions
    )
    if use_spatial:
        reference = orientations[0]
        assert reference is not None
        use_spatial = all(
            all(abs(left - right) <= 1e-6 for left, right in zip(reference, item))
            for item in orientations
            if item is not None
        )
    if use_spatial:
        normal = _normal(orientations[0])  # type: ignore[arg-type]

        def spatial_key(pair: tuple[Instance, tuple[float, ...] | None]):
            instance, position = pair
            assert position is not None
            distance = sum(position[index] * normal[index] for index in range(3))
            return (distance, instance.sop_instance_uid)

        return [
            pair[0]
            for pair in sorted(zip(instances, positions), key=spatial_key)
        ]
    return sorted(
        instances,
        key=lambda item: (
            item.instance_number is None,
            item.instance_number if item.instance_number is not None else 0,
            item.sop_instance_uid,
        ),
    )


def list_patient_studies(session: Session, patient_id: UUID) -> list[StudyRead]:
    try:
        if session.get(Patient, patient_id) is None:
            raise PatientNotFoundError()
        studies = session.scalars(
            select(Study)
            .where(Study.patient_id == patient_id)
            .order_by(
                Study.study_date.desc().nulls_last(),
                Study.created_at.desc(),
                Study.study_instance_uid.asc(),
            )
        ).all()
        result: list[StudyRead] = []
        for study in studies:
            series_count = session.scalar(
                select(func.count(Series.id)).where(Series.study_id == study.id)
            )
            instance_count = session.scalar(
                select(func.count(Instance.id))
                .join(Series, Instance.series_id == Series.id)
                .where(Series.study_id == study.id)
            )
            result.append(
                StudyRead(
                    id=study.id,
                    study_instance_uid=study.study_instance_uid,
                    dicom_patient_id=study.dicom_patient_id,
                    study_date=study.study_date,
                    study_time=study.study_time,
                    accession_number=study.accession_number,
                    description=study.description,
                    series_count=int(series_count or 0),
                    instance_count=int(instance_count or 0),
                    created_at=study.created_at,
                )
            )
        return result
    except PatientNotFoundError:
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def list_study_series(session: Session, study_id: UUID) -> list[SeriesRead]:
    try:
        if session.get(Study, study_id) is None:
            raise StudyNotFoundError()
        series_items = session.scalars(
            select(Series)
            .where(Series.study_id == study_id)
            .order_by(
                Series.series_number.asc().nulls_last(),
                Series.series_instance_uid.asc(),
            )
        ).all()
        return [
            SeriesRead(
                id=item.id,
                series_instance_uid=item.series_instance_uid,
                modality=item.modality,
                series_number=item.series_number,
                description=item.description,
                body_part_examined=item.body_part_examined,
                rows=item.rows,
                columns=item.columns,
                instance_count=int(
                    session.scalar(
                        select(func.count(Instance.id)).where(
                            Instance.series_id == item.id
                        )
                    )
                    or 0
                ),
                viewability_status=item.viewability_status,
                viewability_reason=item.viewability_reason,
            )
            for item in series_items
        ]
    except StudyNotFoundError:
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def get_series_details(session: Session, series_id: UUID) -> SeriesDetailRead:
    try:
        series = session.get(Series, series_id)
        if series is None:
            raise SeriesNotFoundError()
        instances = session.scalars(
            select(Instance).where(Instance.series_id == series.id)
        ).all()
        ordered = _ordered_instances(list(instances))
        return SeriesDetailRead(
            id=series.id,
            series_instance_uid=series.series_instance_uid,
            modality=series.modality,
            series_number=series.series_number,
            description=series.description,
            body_part_examined=series.body_part_examined,
            rows=series.rows,
            columns=series.columns,
            instance_count=len(ordered),
            viewability_status=series.viewability_status,
            viewability_reason=series.viewability_reason,
            instances=[_instance_read(item) for item in ordered],
        )
    except SeriesNotFoundError:
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
