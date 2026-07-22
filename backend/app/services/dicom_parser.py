from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from enum import StrEnum
import math
from pathlib import Path
from typing import Any

from pydicom import dcmread
from pydicom.errors import InvalidDicomError
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian, UID


SUPPORTED_TRANSFER_SYNTAXES = frozenset(
    {str(ImplicitVRLittleEndian), str(ExplicitVRLittleEndian)}
)


class ParseCategory(StrEnum):
    CANDIDATE = "candidate"
    SKIPPED = "skipped"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class DicomMetadata:
    patient_id: str
    study_instance_uid: str
    series_instance_uid: str
    sop_instance_uid: str
    sop_class_uid: str
    transfer_syntax_uid: str
    study_date: date | None
    study_time: time | None
    accession_number: str | None
    study_description: str | None
    series_number: int | None
    series_description: str | None
    body_part_examined: str | None
    instance_number: int | None
    image_position_patient: tuple[float, float, float] | None
    image_orientation_patient: tuple[float, float, float, float, float, float] | None
    rows: int | None
    columns: int | None
    has_pixel_data: bool
    viewability_status: str
    viewability_reason: str | None


@dataclass(frozen=True, slots=True)
class ParsedDicom:
    source_path: Path
    display_name: str
    category: ParseCategory
    code: str
    message: str
    metadata: DicomMetadata | None = None


def _result(
    path: Path,
    display_name: str,
    category: ParseCategory,
    code: str,
    message: str,
    metadata: DicomMetadata | None = None,
) -> ParsedDicom:
    return ParsedDicom(path.resolve(), display_name, category, code, message, metadata)


def _has_dicom_prefix(path: Path) -> bool:
    try:
        with path.open("rb") as stream:
            prefix = stream.read(132)
    except OSError:
        return False
    return len(prefix) >= 132 and prefix[128:132] == b"DICM"


def _text(dataset: Any, name: str, max_length: int) -> str | None:
    value = getattr(dataset, name, None)
    if value is None:
        return None
    result = str(value).strip()
    if not result or len(result) > max_length:
        return None
    if any(ord(character) < 32 or ord(character) == 127 for character in result):
        return None
    return result


def _valid_uid(value: Any) -> str | None:
    if value is None:
        return None
    candidate = str(value).strip()
    if not candidate or len(candidate) > 64:
        return None
    uid = UID(candidate)
    return candidate if uid.is_valid else None


def _integer(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _positive_integer(value: Any) -> int | None:
    result = _integer(value)
    return result if result is not None and result > 0 else None


def _float_tuple(value: Any, length: int) -> tuple[float, ...] | None:
    if value is None:
        return None
    try:
        result = tuple(float(item) for item in value)
    except (TypeError, ValueError):
        return None
    if len(result) != length or not all(math.isfinite(item) for item in result):
        return None
    return result


def _date(value: Any) -> date | None:
    if value is None:
        return None
    try:
        return datetime.strptime(str(value), "%Y%m%d").date()
    except (TypeError, ValueError):
        return None


def _time(value: Any) -> time | None:
    if value is None:
        return None
    raw = str(value).split(".", maxsplit=1)[0].ljust(6, "0")[:6]
    try:
        return datetime.strptime(raw, "%H%M%S").time()
    except (TypeError, ValueError):
        return None


def parse_dicom(path: Path, display_name: str) -> ParsedDicom:
    resolved_path = path.resolve()
    has_prefix = _has_dicom_prefix(resolved_path)
    try:
        dataset = dcmread(resolved_path, defer_size=1024, force=False)
    except InvalidDicomError:
        return _result(
            resolved_path,
            display_name,
            ParseCategory.FAILED if has_prefix else ParseCategory.SKIPPED,
            "damaged_dicom" if has_prefix else "non_dicom",
            "DICOM 文件已损坏" if has_prefix else "不是 DICOM 文件",
        )
    except (OSError, ValueError, EOFError):
        return _result(
            resolved_path,
            display_name,
            ParseCategory.FAILED,
            "damaged_dicom",
            "无法读取 DICOM 文件",
        )

    if has_prefix and not any(
        hasattr(dataset, field)
        for field in ("PatientID", "Modality", "StudyInstanceUID", "SOPClassUID")
    ):
        return _result(
            resolved_path,
            display_name,
            ParseCategory.FAILED,
            "damaged_dicom",
            "DICOM 文件缺少可解析内容",
        )

    modality = _text(dataset, "Modality", 16)
    if modality != "CT":
        return _result(
            resolved_path,
            display_name,
            ParseCategory.SKIPPED,
            "non_ct_modality",
            "当前功能只接受 CT DICOM",
        )

    patient_id = _text(dataset, "PatientID", 64)
    if patient_id is None:
        return _result(
            resolved_path,
            display_name,
            ParseCategory.SKIPPED,
            "missing_patient_id",
            "DICOM 缺少 PatientID",
        )

    required_uids = (
        ("StudyInstanceUID", "study_instance_uid"),
        ("SeriesInstanceUID", "series_instance_uid"),
        ("SOPInstanceUID", "sop_instance_uid"),
        ("SOPClassUID", "sop_class_uid"),
    )
    parsed_uids: dict[str, str] = {}
    for dicom_name, public_name in required_uids:
        value = _valid_uid(getattr(dataset, dicom_name, None))
        if value is None:
            return _result(
                resolved_path,
                display_name,
                ParseCategory.FAILED,
                f"missing_{public_name}",
                f"DICOM 缺少有效的 {dicom_name}",
            )
        parsed_uids[public_name] = value

    transfer_syntax_uid = _valid_uid(
        getattr(getattr(dataset, "file_meta", None), "TransferSyntaxUID", None)
    )
    if transfer_syntax_uid is None:
        return _result(
            resolved_path,
            display_name,
            ParseCategory.FAILED,
            "missing_transfer_syntax_uid",
            "DICOM 缺少有效的 TransferSyntaxUID",
        )

    position = _float_tuple(getattr(dataset, "ImagePositionPatient", None), 3)
    orientation = _float_tuple(
        getattr(dataset, "ImageOrientationPatient", None), 6
    )
    rows = _positive_integer(getattr(dataset, "Rows", None))
    columns = _positive_integer(getattr(dataset, "Columns", None))
    has_pixel_data = "PixelData" in dataset

    viewability_reason: str | None = None
    if transfer_syntax_uid not in SUPPORTED_TRANSFER_SYNTAXES:
        viewability_reason = "unsupported_transfer_syntax"
    elif not has_pixel_data:
        viewability_reason = "missing_pixel_data"
    elif rows is None or columns is None:
        viewability_reason = "missing_dimensions"
    elif position is None or orientation is None:
        viewability_reason = "missing_geometry"

    metadata = DicomMetadata(
        patient_id=patient_id,
        study_instance_uid=parsed_uids["study_instance_uid"],
        series_instance_uid=parsed_uids["series_instance_uid"],
        sop_instance_uid=parsed_uids["sop_instance_uid"],
        sop_class_uid=parsed_uids["sop_class_uid"],
        transfer_syntax_uid=transfer_syntax_uid,
        study_date=_date(getattr(dataset, "StudyDate", None)),
        study_time=_time(getattr(dataset, "StudyTime", None)),
        accession_number=_text(dataset, "AccessionNumber", 64),
        study_description=_text(dataset, "StudyDescription", 256),
        series_number=_integer(getattr(dataset, "SeriesNumber", None)),
        series_description=_text(dataset, "SeriesDescription", 256),
        body_part_examined=_text(dataset, "BodyPartExamined", 64),
        instance_number=_integer(getattr(dataset, "InstanceNumber", None)),
        image_position_patient=position,
        image_orientation_patient=orientation,
        rows=rows,
        columns=columns,
        has_pixel_data=has_pixel_data,
        viewability_status="unsupported" if viewability_reason else "eligible",
        viewability_reason=viewability_reason,
    )
    if viewability_reason is not None:
        messages = {
            "unsupported_transfer_syntax": "当前版本不支持该传输语法的后续查看",
            "missing_pixel_data": "DICOM 缺少像素数据",
            "missing_dimensions": "DICOM 缺少有效图像尺寸",
            "missing_geometry": "DICOM 缺少空间位置或方向信息",
        }
        return _result(
            resolved_path,
            display_name,
            ParseCategory.UNSUPPORTED,
            viewability_reason,
            messages[viewability_reason],
            metadata,
        )

    return _result(
        resolved_path,
        display_name,
        ParseCategory.CANDIDATE,
        "eligible_ct",
        "CT DICOM 可以导入",
        metadata,
    )
