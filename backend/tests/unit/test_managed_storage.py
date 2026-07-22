from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import UUID

import pytest

from app.core.config import load_settings
from app.services.dicom_parser import DicomMetadata
from app.services.managed_storage import (
    ManagedStorage,
    StagedPatientDirectory,
    StorageConflictError,
    UnsafeManagedPathError,
)


PATIENT_ID = UUID("11111111-1111-4111-8111-111111111111")
FIRST_STAGED_DELETE = (
    "11111111-1111-4111-8111-111111111111-"
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)
SECOND_STAGED_DELETE = (
    "22222222-2222-4222-8222-222222222222-"
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
)


def _create_directory_symlink(link: Path, target: Path) -> None:
    try:
        os.symlink(target, link, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"real directory symlink unavailable: {error}")


def _metadata() -> DicomMetadata:
    return DicomMetadata(
        patient_id="MR-DICOM-001",
        study_instance_uid="1.2.840.10008.1",
        series_instance_uid="1.2.840.10008.2",
        sop_instance_uid="1.2.840.10008.3",
        sop_class_uid="1.2.840.10008.5.1.4.1.1.2",
        transfer_syntax_uid="1.2.840.10008.1.2.1",
        study_date=None,
        study_time=None,
        accession_number=None,
        study_description=None,
        series_number=None,
        series_description=None,
        body_part_examined=None,
        instance_number=None,
        image_position_patient=None,
        image_orientation_patient=None,
        rows=2,
        columns=2,
        has_pixel_data=True,
        viewability_status="eligible",
        viewability_reason=None,
    )


def test_settings_derive_all_managed_directories(tmp_path: Path) -> None:
    settings = load_settings(data_dir_override=tmp_path)

    assert settings.imports_dir == tmp_path.resolve() / ".imports"
    assert settings.dicom_dir == tmp_path.resolve() / "dicom"
    assert settings.delete_staging_dir == tmp_path.resolve() / ".delete-staging"


def test_import_session_is_removed_after_cleanup(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    session = storage.create_import_session()
    staged = session.path / "file.dcm"
    staged.write_bytes(b"dicom")

    session.cleanup()

    assert not session.path.exists()


def test_target_path_is_deterministic_and_contained(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))

    target = storage.target_path(PATIENT_ID, _metadata())

    assert target == (
        tmp_path.resolve()
        / "dicom"
        / str(PATIENT_ID)
        / "1.2.840.10008.1"
        / "1.2.840.10008.2"
        / "1.2.840.10008.3.dcm"
    )


def test_target_path_rejects_unsafe_uid_segment(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    metadata = _metadata()
    object.__setattr__(metadata, "study_instance_uid", "../../escape")

    with pytest.raises(UnsafeManagedPathError):
        storage.target_path(PATIENT_ID, metadata)


def test_store_new_refuses_unknown_existing_target(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    source = tmp_path / "source.dcm"
    source.write_bytes(b"new")
    target = storage.target_path(PATIENT_ID, _metadata())
    target.parent.mkdir(parents=True)
    target.write_bytes(b"existing")

    with pytest.raises(StorageConflictError):
        storage.store_new(source, target)

    assert target.read_bytes() == b"existing"


def test_store_and_cleanup_only_current_operation_files(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    source = tmp_path / "source.dcm"
    source.write_bytes(b"new")
    target = storage.target_path(PATIENT_ID, _metadata())
    existing = target.parent / "existing.dcm"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"existing")

    stored = storage.store_new(source, target)
    storage.cleanup_created([stored])

    assert not target.exists()
    assert existing.read_bytes() == b"existing"


def test_stage_restore_and_purge_patient_directory(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    patient_dir = storage.patient_directory(PATIENT_ID)
    patient_dir.mkdir(parents=True)
    (patient_dir / "file.dcm").write_bytes(b"managed")

    staged = storage.stage_patient_delete(PATIENT_ID)
    assert not patient_dir.exists()
    assert staged.staged_path is not None and staged.staged_path.exists()

    storage.restore_patient_delete(staged)
    assert (patient_dir / "file.dcm").read_bytes() == b"managed"

    staged_again = storage.stage_patient_delete(PATIENT_ID)
    storage.purge_patient_delete(staged_again)
    assert staged_again.staged_path is not None
    assert not staged_again.staged_path.exists()


@pytest.mark.parametrize("root_check", ["is_symlink", "is_junction"])
def test_stage_patient_delete_rejects_linked_staging_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    root_check: str,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    patient_directory = storage.patient_directory(PATIENT_ID)
    patient_directory.mkdir(parents=True)
    staging_root = storage.delete_staging_dir
    staging_root.mkdir(parents=True)
    original_check = getattr(Path, root_check)

    def identify_link(path: Path) -> bool:
        return path == staging_root or original_check(path)

    monkeypatch.setattr(Path, root_check, identify_link)

    with pytest.raises(UnsafeManagedPathError):
        storage.stage_patient_delete(PATIENT_ID)

    assert patient_directory.is_dir()


@pytest.mark.parametrize("operation", ["restore_patient_delete", "purge_patient_delete"])
def test_staged_patient_operation_rejects_replaced_staging_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    patient_directory = storage.patient_directory(PATIENT_ID)
    patient_directory.mkdir(parents=True)
    staged = storage.stage_patient_delete(PATIENT_ID)
    staging_root = storage.delete_staging_dir
    original_check = Path.is_symlink

    def identify_link(path: Path) -> bool:
        return path == staging_root or original_check(path)

    monkeypatch.setattr(Path, "is_symlink", identify_link)

    with pytest.raises(UnsafeManagedPathError):
        getattr(storage, operation)(staged)


@pytest.mark.parametrize("operation", ["restore_patient_delete", "purge_patient_delete"])
def test_staged_patient_directory_rejects_link(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    staging_root = storage.delete_staging_dir
    staging_root.mkdir(parents=True)
    staged_path = staging_root / FIRST_STAGED_DELETE
    staged_path.mkdir()
    staged = StagedPatientDirectory(
        PATIENT_ID,
        storage.patient_directory(PATIENT_ID),
        staged_path,
    )
    original_check = Path.is_symlink

    def identify_link(path: Path) -> bool:
        return path == staged_path or original_check(path)

    monkeypatch.setattr(Path, "is_symlink", identify_link)

    with pytest.raises(UnsafeManagedPathError):
        getattr(storage, operation)(staged)

    assert staged_path.is_dir()


@pytest.mark.parametrize("operation", ["restore_patient_delete", "purge_patient_delete"])
def test_staged_patient_directory_rejects_path_outside_staging_root(
    tmp_path: Path,
    operation: str,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    storage.delete_staging_dir.mkdir(parents=True)
    outside_path = tmp_path / "outside-staged"
    outside_path.mkdir()
    staged = StagedPatientDirectory(
        PATIENT_ID,
        storage.patient_directory(PATIENT_ID),
        outside_path,
    )

    with pytest.raises(UnsafeManagedPathError):
        getattr(storage, operation)(staged)

    assert outside_path.is_dir()


def test_real_staging_root_symlink_is_rejected_without_following_target(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    patient_directory = storage.patient_directory(PATIENT_ID)
    patient_directory.mkdir(parents=True)
    root_target = tmp_path / "root-symlink-target"
    root_target.mkdir()
    _create_directory_symlink(storage.delete_staging_dir, root_target)

    with pytest.raises(UnsafeManagedPathError):
        storage.stage_patient_delete(PATIENT_ID)

    assert patient_directory.is_dir()
    assert storage.cleanup_pending_patient_deletes() == 1
    assert root_target.is_dir()


def test_real_staged_child_symlink_is_rejected_without_following_target(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    storage.delete_staging_dir.mkdir(parents=True)
    child_target = tmp_path / "child-symlink-target"
    child_target.mkdir()
    sentinel = child_target / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")
    child_link = storage.delete_staging_dir / FIRST_STAGED_DELETE
    _create_directory_symlink(child_link, child_target)
    staged = StagedPatientDirectory(
        PATIENT_ID,
        storage.patient_directory(PATIENT_ID),
        child_link,
    )

    with pytest.raises(UnsafeManagedPathError):
        storage.restore_patient_delete(staged)
    with pytest.raises(UnsafeManagedPathError):
        storage.purge_patient_delete(staged)

    assert storage.cleanup_pending_patient_deletes() == 1
    assert child_link.is_symlink()
    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_cleanup_pending_patient_deletes_is_noop_when_staging_missing(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 0
    assert not storage.delete_staging_dir.exists()


def test_cleanup_pending_patient_deletes_removes_safe_directories(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    first = storage.delete_staging_dir / FIRST_STAGED_DELETE
    second = storage.delete_staging_dir / SECOND_STAGED_DELETE
    first.mkdir(parents=True)
    second.mkdir()
    (first / "file.dcm").write_bytes(b"first")
    (second / "file.dcm").write_bytes(b"second")

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 0
    assert not first.exists()
    assert not second.exists()


def test_cleanup_pending_patient_deletes_continues_after_rmtree_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    second = storage.delete_staging_dir / SECOND_STAGED_DELETE
    first = storage.delete_staging_dir / FIRST_STAGED_DELETE
    second.mkdir(parents=True)
    first.mkdir()
    original_rmtree = shutil.rmtree
    removed: list[str] = []

    def fail_first(path: Path) -> None:
        removed.append(path.name)
        if path.name == FIRST_STAGED_DELETE:
            raise OSError("forced cleanup failure")
        original_rmtree(path)

    monkeypatch.setattr(
        "app.services.managed_storage.shutil.rmtree",
        fail_first,
    )

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert removed == [FIRST_STAGED_DELETE, SECOND_STAGED_DELETE]
    assert first.is_dir()
    assert not second.exists()


def test_cleanup_pending_patient_deletes_counts_invalid_staging_root(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    storage.delete_staging_dir.parent.mkdir(parents=True, exist_ok=True)
    storage.delete_staging_dir.write_text("keep", encoding="utf-8")

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert storage.delete_staging_dir.read_text(encoding="utf-8") == "keep"


def test_cleanup_pending_patient_deletes_keeps_regular_files(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    unexpected_file = storage.delete_staging_dir / "unexpected.txt"
    unexpected_file.parent.mkdir(parents=True)
    unexpected_file.write_text("keep", encoding="utf-8")

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert unexpected_file.read_text(encoding="utf-8") == "keep"


@pytest.mark.parametrize("directory_check", ["is_symlink", "is_junction"])
def test_cleanup_pending_patient_deletes_keeps_directory_links(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_check: str,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    linked_directory = storage.delete_staging_dir / "linked"
    linked_directory.mkdir(parents=True)
    original_check = getattr(Path, directory_check)

    def identify_link(path: Path) -> bool:
        return path == linked_directory or original_check(path)

    monkeypatch.setattr(Path, directory_check, identify_link)

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert linked_directory.is_dir()


def test_cleanup_pending_patient_deletes_keeps_uncontained_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    unsafe_directory = storage.delete_staging_dir / "unsafe"
    safe_directory = storage.delete_staging_dir / "safe"
    unsafe_directory.mkdir(parents=True)
    safe_directory.mkdir()
    original_ensure_within = storage._ensure_within

    def reject_unsafe(path: Path, root: Path) -> Path:
        if path == unsafe_directory:
            raise UnsafeManagedPathError("forced containment failure")
        return original_ensure_within(path, root)

    monkeypatch.setattr(storage, "_ensure_within", reject_unsafe)

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert unsafe_directory.is_dir()
    assert not safe_directory.exists()
