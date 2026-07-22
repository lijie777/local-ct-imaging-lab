from __future__ import annotations

from pydicom import dcmread

from tests.dicom_factory import write_dicom_file


def test_writes_deidentified_ct_fixture_with_required_metadata(tmp_path) -> None:
    fixture = write_dicom_file(tmp_path / "image-001.dcm")

    dataset = dcmread(fixture.path, defer_size=1024)

    assert dataset.PatientID == "MR-DICOM-001"
    assert dataset.Modality == "CT"
    assert dataset.StudyInstanceUID == fixture.study_uid
    assert dataset.SeriesInstanceUID == fixture.series_uid
    assert dataset.SOPInstanceUID == fixture.sop_uid
    assert dataset.Rows == 2
    assert dataset.Columns == 2
    assert "PixelData" in dataset
    assert dataset.PatientName == "Teaching^Patient"
