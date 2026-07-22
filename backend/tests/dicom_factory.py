from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from pathlib import Path

from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import (
    CTImageStorage,
    ExplicitVRLittleEndian,
    PYDICOM_IMPLEMENTATION_UID,
    generate_uid,
)


@dataclass(frozen=True, slots=True)
class DicomFixture:
    path: Path
    study_uid: str
    series_uid: str
    sop_uid: str


def write_dicom_file(
    path: Path,
    *,
    patient_id: str = "MR-DICOM-001",
    modality: str = "CT",
    study_uid: str | None = None,
    series_uid: str | None = None,
    sop_uid: str | None = None,
    transfer_syntax_uid: str = ExplicitVRLittleEndian,
    include_pixel_data: bool = True,
    include_geometry: bool = True,
    instance_number: int = 1,
) -> DicomFixture:
    resolved_study_uid = study_uid or generate_uid()
    resolved_series_uid = series_uid or generate_uid()
    resolved_sop_uid = sop_uid or generate_uid()

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = CTImageStorage
    file_meta.MediaStorageSOPInstanceUID = resolved_sop_uid
    file_meta.TransferSyntaxUID = transfer_syntax_uid
    file_meta.ImplementationClassUID = PYDICOM_IMPLEMENTATION_UID

    dataset = FileDataset(
        str(path),
        {},
        file_meta=file_meta,
        preamble=b"\0" * 128,
    )
    dataset.SOPClassUID = CTImageStorage
    dataset.SOPInstanceUID = resolved_sop_uid
    dataset.StudyInstanceUID = resolved_study_uid
    dataset.SeriesInstanceUID = resolved_series_uid
    dataset.PatientID = patient_id
    dataset.PatientName = "Teaching^Patient"
    dataset.Modality = modality
    dataset.StudyDate = date(2026, 7, 20).strftime("%Y%m%d")
    dataset.StudyTime = time(9, 30, 0).strftime("%H%M%S")
    dataset.StudyDescription = "De-identified teaching CT"
    dataset.AccessionNumber = "ACC-TEACHING"
    dataset.SeriesNumber = 1
    dataset.SeriesDescription = "Axial teaching series"
    dataset.BodyPartExamined = "CHEST"
    dataset.InstanceNumber = instance_number
    dataset.Rows = 2
    dataset.Columns = 2
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 16
    dataset.BitsStored = 12
    dataset.HighBit = 11
    dataset.PixelRepresentation = 0
    if include_geometry:
        dataset.ImagePositionPatient = [0.0, 0.0, float(instance_number - 1)]
        dataset.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    if include_pixel_data:
        dataset.PixelData = b"\x00\x00\x01\x00\x02\x00\x03\x00"

    path.parent.mkdir(parents=True, exist_ok=True)
    dataset.save_as(path, enforce_file_format=True)
    return DicomFixture(
        path=path,
        study_uid=resolved_study_uid,
        series_uid=resolved_series_uid,
        sop_uid=resolved_sop_uid,
    )
