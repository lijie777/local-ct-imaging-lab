from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import json
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import PatientNotFoundError, PersistenceError
from app.models.instance import Instance
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study
from app.schemas.dicom_import import (
    ImportCategory,
    ImportItem,
    ImportReport,
)
from app.services.dicom_parser import ParseCategory, ParsedDicom, parse_dicom
from app.services.managed_storage import ManagedStorage, ManagedStorageError, StoredFile


SERIES_REASON_PRIORITY = {
    "unsupported_transfer_syntax": 0,
    "missing_pixel_data": 1,
    "missing_dimensions": 2,
    "missing_geometry": 3,
    "inconsistent_dimensions": 4,
    "inconsistent_orientation": 5,
}
ORIENTATION_COMPONENT_TOLERANCE = 1e-6


@dataclass(frozen=True, slots=True)
class ImportSource:
    path: Path
    display_name: str


def _report_item(
    parsed: ParsedDicom,
    category: ImportCategory,
    code: str,
    message: str,
) -> ImportItem:
    metadata = parsed.metadata
    return ImportItem(
        file_name=parsed.display_name,
        category=category,
        code=code,
        message=message,
        study_instance_uid=(metadata.study_instance_uid if metadata else None),
        series_instance_uid=(metadata.series_instance_uid if metadata else None),
        sop_instance_uid=(metadata.sop_instance_uid if metadata else None),
    )


def _parser_item(parsed: ParsedDicom) -> ImportItem:
    category = {
        ParseCategory.SKIPPED: ImportCategory.SKIPPED,
        ParseCategory.FAILED: ImportCategory.FAILED,
        ParseCategory.UNSUPPORTED: ImportCategory.UNSUPPORTED,
        ParseCategory.CANDIDATE: ImportCategory.SUCCESS,
    }[parsed.category]
    return _report_item(parsed, category, parsed.code, parsed.message)


def _build_report(items: list[ImportItem]) -> ImportReport:
    counts = {category: 0 for category in ImportCategory}
    for item in items:
        counts[item.category] += 1
    return ImportReport(
        total=len(items),
        success=counts[ImportCategory.SUCCESS],
        duplicate=counts[ImportCategory.DUPLICATE],
        skipped=counts[ImportCategory.SKIPPED],
        unsupported=counts[ImportCategory.UNSUPPORTED],
        failed=counts[ImportCategory.FAILED],
        items=items,
    )


def _normalized(value: str) -> str:
    return value.strip().casefold()


def _json_vector(value: tuple[float, ...] | None) -> str | None:
    return None if value is None else json.dumps(value, separators=(",", ":"))


def _mark_group(
    results: list[ImportItem | None],
    group: list[tuple[int, ParsedDicom]],
    category: ImportCategory,
    code: str,
    message: str,
    *,
    preserve_duplicates: bool = False,
) -> None:
    for index, parsed in group:
        if (
            preserve_duplicates
            and results[index] is not None
            and results[index].category is ImportCategory.DUPLICATE
        ):
            continue
        results[index] = _report_item(parsed, category, code, message)


def _apply_series_reason(current: Series, reason: str) -> None:
    current_priority = SERIES_REASON_PRIORITY.get(current.viewability_reason or "", 99)
    next_priority = SERIES_REASON_PRIORITY.get(reason, 99)
    if current.viewability_status == "eligible" or next_priority < current_priority:
        current.viewability_status = "unsupported"
        current.viewability_reason = reason


def _stored_orientations(session: Session, series_id: UUID) -> set[tuple[float, ...]]:
    values = session.scalars(
        select(Instance.image_orientation_patient).where(
            Instance.series_id == series_id,
            Instance.image_orientation_patient.is_not(None),
        )
    ).all()
    orientations: set[tuple[float, ...]] = set()
    for value in values:
        try:
            decoded = json.loads(value)
            orientations.add(tuple(float(item) for item in decoded))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return orientations


def _orientations_match(
    first: tuple[float, ...],
    second: tuple[float, ...],
) -> bool:
    return len(first) == len(second) and all(
        abs(first_value - second_value) <= ORIENTATION_COMPONENT_TOLERANCE
        for first_value, second_value in zip(first, second, strict=True)
    )


def _series_reason(
    current: Series,
    parsed: ParsedDicom,
    known_orientations: set[tuple[float, ...]],
) -> None:
    metadata = parsed.metadata
    if metadata is None:
        return
    if metadata.viewability_status == "unsupported":
        assert metadata.viewability_reason is not None
        _apply_series_reason(current, metadata.viewability_reason)
    if current.rows is None:
        current.rows = metadata.rows
    elif metadata.rows is not None and current.rows != metadata.rows:
        _apply_series_reason(current, "inconsistent_dimensions")
    if current.columns is None:
        current.columns = metadata.columns
    elif metadata.columns is not None and current.columns != metadata.columns:
        _apply_series_reason(current, "inconsistent_dimensions")
    if metadata.image_orientation_patient is not None:
        if (
            known_orientations
            and not any(
                _orientations_match(metadata.image_orientation_patient, orientation)
                for orientation in known_orientations
            )
        ):
            _apply_series_reason(current, "inconsistent_orientation")


def _import_study_group(
    session: Session,
    patient: Patient,
    group: list[tuple[int, ParsedDicom]],
    storage: ManagedStorage,
    results: list[ImportItem | None],
    seen_sop_uids: set[str],
) -> None:
    first_metadata = group[0][1].metadata
    assert first_metadata is not None

    normalized_patient_ids = {
        _normalized(parsed.metadata.patient_id)
        for _index, parsed in group
        if parsed.metadata is not None
    }
    if normalized_patient_ids != {patient.medical_record_no_normalized}:
        _mark_group(
            results,
            group,
            ImportCategory.SKIPPED,
            "patient_mismatch",
            "DICOM PatientID 与当前病历号不匹配",
        )
        return

    existing_study = session.scalar(
        select(Study).where(
            Study.study_instance_uid == first_metadata.study_instance_uid
        )
    )
    if existing_study is not None and existing_study.patient_id != patient.id:
        _mark_group(
            results,
            group,
            ImportCategory.SKIPPED,
            "study_patient_conflict",
            "该检查已归属于另一位病人",
        )
        return

    stored_files: list[StoredFile] = []
    attempted_targets: list[Path] = []
    group_seen_sop_uids = set(seen_sop_uids)
    try:
        study = existing_study
        if study is None:
            study = Study(
                patient_id=patient.id,
                study_instance_uid=first_metadata.study_instance_uid,
                dicom_patient_id=first_metadata.patient_id,
                study_date=first_metadata.study_date,
                study_time=first_metadata.study_time,
                accession_number=first_metadata.accession_number,
                description=first_metadata.study_description,
            )
            session.add(study)
            session.flush()

        series_by_uid: dict[str, Series] = {}
        existing_series = session.scalars(
            select(Series).where(Series.study_id == study.id)
        ).all()
        series_by_uid.update(
            {item.series_instance_uid: item for item in existing_series}
        )
        orientations_by_series = {
            item.series_instance_uid: _stored_orientations(session, item.id)
            for item in existing_series
        }

        for index, parsed in group:
            metadata = parsed.metadata
            assert metadata is not None
            if metadata.sop_instance_uid in group_seen_sop_uids:
                results[index] = _report_item(
                    parsed,
                    ImportCategory.DUPLICATE,
                    "duplicate_sop_instance_uid",
                    "实例已存在，未重复保存",
                )
                continue
            existing_instance = session.scalar(
                select(Instance.id).where(
                    Instance.sop_instance_uid == metadata.sop_instance_uid
                )
            )
            if existing_instance is not None:
                group_seen_sop_uids.add(metadata.sop_instance_uid)
                results[index] = _report_item(
                    parsed,
                    ImportCategory.DUPLICATE,
                    "duplicate_sop_instance_uid",
                    "实例已存在，未重复保存",
                )
                continue

            series = series_by_uid.get(metadata.series_instance_uid)
            if series is None:
                conflicting_series = session.scalar(
                    select(Series).where(
                        Series.series_instance_uid == metadata.series_instance_uid
                    )
                )
                if conflicting_series is not None:
                    raise ManagedStorageError(
                        "SeriesInstanceUID belongs to another Study"
                    )
                series = Series(
                    study_id=study.id,
                    series_instance_uid=metadata.series_instance_uid,
                    modality="CT",
                    series_number=metadata.series_number,
                    description=metadata.series_description,
                    body_part_examined=metadata.body_part_examined,
                    rows=metadata.rows,
                    columns=metadata.columns,
                    viewability_status=metadata.viewability_status,
                    viewability_reason=metadata.viewability_reason,
                )
                session.add(series)
                session.flush()
                series_by_uid[metadata.series_instance_uid] = series
                orientations_by_series[metadata.series_instance_uid] = set()
            else:
                _series_reason(
                    series,
                    parsed,
                    orientations_by_series.setdefault(
                        metadata.series_instance_uid,
                        set(),
                    ),
                )

            target = storage.target_path(patient.id, metadata)
            if not target.exists():
                attempted_targets.append(target)
            stored = storage.store_new(parsed.source_path, target)
            stored_files.append(stored)
            relative_path = target.relative_to(storage.data_dir).as_posix()
            session.add(
                Instance(
                    series_id=series.id,
                    sop_instance_uid=metadata.sop_instance_uid,
                    sop_class_uid=metadata.sop_class_uid,
                    transfer_syntax_uid=metadata.transfer_syntax_uid,
                    instance_number=metadata.instance_number,
                    image_position_patient=_json_vector(
                        metadata.image_position_patient
                    ),
                    image_orientation_patient=_json_vector(
                        metadata.image_orientation_patient
                    ),
                    rows=metadata.rows,
                    columns=metadata.columns,
                    managed_path=relative_path,
                    file_size=stored.file_size,
                )
            )
            if metadata.image_orientation_patient is not None:
                orientations_by_series[metadata.series_instance_uid].add(
                    metadata.image_orientation_patient
                )
            group_seen_sop_uids.add(metadata.sop_instance_uid)
            if parsed.category is ParseCategory.UNSUPPORTED:
                results[index] = _report_item(
                    parsed,
                    ImportCategory.UNSUPPORTED,
                    parsed.code,
                    parsed.message,
                )
            else:
                results[index] = _report_item(
                    parsed,
                    ImportCategory.SUCCESS,
                    "imported",
                    "CT DICOM 已保存",
                )

        session.flush()
        session.commit()
        seen_sop_uids.update(group_seen_sop_uids)
    except (SQLAlchemyError, ManagedStorageError, OSError):
        session.rollback()
        storage.cleanup_created(stored_files)
        stored_paths = {stored.path for stored in stored_files}
        storage.cleanup_paths(
            [target for target in attempted_targets if target not in stored_paths]
        )
        _mark_group(
            results,
            group,
            ImportCategory.FAILED,
            "study_import_failed",
            "该检查无法保存，本次新增内容已清理",
            preserve_duplicates=True,
        )


def import_dicom_files(
    session: Session,
    patient_id: UUID,
    sources: list[ImportSource],
    storage: ManagedStorage,
) -> ImportReport:
    if not sources:
        raise ValueError("At least one import source is required")
    try:
        patient = session.get(Patient, patient_id)
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
    if patient is None:
        raise PatientNotFoundError()

    parsed_files = [
        parse_dicom(source.path, source.display_name) for source in sources
    ]
    results: list[ImportItem | None] = [None] * len(parsed_files)
    groups: dict[str, list[tuple[int, ParsedDicom]]] = defaultdict(list)
    for index, parsed in enumerate(parsed_files):
        if parsed.category in {ParseCategory.CANDIDATE, ParseCategory.UNSUPPORTED}:
            assert parsed.metadata is not None
            groups[parsed.metadata.study_instance_uid].append((index, parsed))
        else:
            results[index] = _parser_item(parsed)

    seen_sop_uids: set[str] = set()
    for group in groups.values():
        _import_study_group(
            session,
            patient,
            group,
            storage,
            results,
            seen_sop_uids,
        )

    if any(item is None for item in results):
        raise RuntimeError("Import report accounting is incomplete")
    return _build_report([item for item in results if item is not None])
