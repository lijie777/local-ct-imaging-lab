from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import load_settings
from app.services.managed_storage import ManagedStorage, UnsafeManagedPathError


def test_resolves_relative_dicom_path_inside_managed_root(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    expected = tmp_path / "dicom" / "patient" / "study" / "image.dcm"

    resolved = storage.resolve_dicom_file("dicom/patient/study/image.dcm")

    assert resolved == expected.resolve()


@pytest.mark.parametrize(
    "value",
    [
        "../outside.dcm",
        "dicom/../../outside.dcm",
    ],
)
def test_rejects_relative_path_escape(tmp_path: Path, value: str) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))

    with pytest.raises(UnsafeManagedPathError):
        storage.resolve_dicom_file(value)


def test_rejects_absolute_path(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))

    with pytest.raises(UnsafeManagedPathError):
        storage.resolve_dicom_file(str((tmp_path / "outside.dcm").resolve()))
