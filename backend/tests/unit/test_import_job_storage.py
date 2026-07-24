from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from uuid import UUID

import pytest

from app.core.config import load_settings
from app.services.import_job_storage import (
    CHUNK_BYTES,
    ImportJobStorage,
    ManagedStorageError,
    UnsafeImportJobPathError,
)


JOB_ID = UUID("11111111-1111-4111-8111-111111111111")
OTHER_JOB_ID = UUID("22222222-2222-4222-8222-222222222222")


def _storage(tmp_path: Path) -> ImportJobStorage:
    return ImportJobStorage(load_settings(data_dir_override=tmp_path))


def _directory_link(link: Path, target: Path) -> None:
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except OSError as error:
        if sys.platform != "win32":
            pytest.skip(f"directory links unavailable: {error}")
    try:
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        pytest.skip(f"directory links unavailable: {error}")


def test_settings_derive_import_jobs_directory_and_ignore_it(tmp_path: Path) -> None:
    settings = load_settings(data_dir_override=tmp_path)

    assert settings.import_jobs_dir == tmp_path.resolve() / ".import-jobs"
    repository_gitignore = Path(__file__).resolve().parents[3] / ".gitignore"
    assert "data/.import-jobs/" in repository_gitignore.read_text(encoding="utf-8")


def test_ensure_job_directory_and_file_path_are_safe(tmp_path: Path) -> None:
    storage = _storage(tmp_path)

    job_dir = storage.ensure_job_dir(JOB_ID)

    assert job_dir == tmp_path.resolve() / ".import-jobs" / str(JOB_ID)
    assert job_dir.is_dir()
    assert storage.file_path(JOB_ID, 3) == job_dir / "3.part"


def test_rejects_job_directory_symlink_without_following_target(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    target = tmp_path / "outside"
    target.mkdir()
    storage.root.mkdir(parents=True)
    _directory_link(storage.root / str(JOB_ID), target)

    with pytest.raises(UnsafeImportJobPathError):
        storage.ensure_job_dir(JOB_ID)

    assert not (target / "3.part").exists()


def test_rejects_root_symlink_without_following_target(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    target = tmp_path / "outside"
    target.mkdir()
    storage.root.parent.mkdir(parents=True, exist_ok=True)
    _directory_link(storage.root, target)

    with pytest.raises(UnsafeImportJobPathError):
        storage.ensure_job_dir(JOB_ID)

    assert not (target / str(JOB_ID)).exists()


@pytest.mark.parametrize("ordinal", [-1, 2_000, "x"])
def test_rejects_unsafe_ordinal(tmp_path: Path, ordinal: object) -> None:
    storage = _storage(tmp_path)

    with pytest.raises(UnsafeImportJobPathError):
        storage.file_path(JOB_ID, ordinal)  # type: ignore[arg-type]


def test_rejects_broken_file_symlink_without_following_target(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _storage(tmp_path)
    job_dir = storage.ensure_job_dir(JOB_ID)
    candidate = job_dir / "0.part"
    original_lstat = Path.lstat
    original_exists = Path.exists
    original_is_symlink = Path.is_symlink

    def fake_lstat(path: Path) -> os.stat_result:
        if path == candidate:
            return os.stat_result((0,) * 10)
        return original_lstat(path)

    def fake_exists(path: Path) -> bool:
        if path == candidate:
            return False
        return original_exists(path)

    def fake_is_symlink(path: Path) -> bool:
        if path == candidate:
            return True
        return original_is_symlink(path)

    monkeypatch.setattr(Path, "lstat", fake_lstat)
    monkeypatch.setattr(Path, "exists", fake_exists)
    monkeypatch.setattr(Path, "is_symlink", fake_is_symlink)

    with pytest.raises(UnsafeImportJobPathError):
        storage.file_path(JOB_ID, 0)
    with pytest.raises(UnsafeImportJobPathError):
        storage.write_chunk(JOB_ID, 0, expected_offset=0, chunk=b"x", file_size=1)


def test_write_chunk_requires_exact_confirmed_offset_and_flushes(tmp_path: Path) -> None:
    storage = _storage(tmp_path)

    assert storage.write_chunk(JOB_ID, 0, expected_offset=0, chunk=b"abc", file_size=6) == 3
    assert storage.file_path(JOB_ID, 0).read_bytes() == b"abc"
    assert storage.write_chunk(JOB_ID, 0, expected_offset=3, chunk=b"def", file_size=6) == 6
    assert storage.file_path(JOB_ID, 0).read_bytes() == b"abcdef"

    assert storage.write_chunk(JOB_ID, 0, expected_offset=0, chunk=b"x", file_size=6) == 1
    assert storage.file_path(JOB_ID, 0).read_bytes() == b"x"


def test_long_disk_tail_is_truncated_before_write(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    path = storage.file_path(JOB_ID, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"confirmed-extra")

    assert storage.write_chunk(JOB_ID, 0, expected_offset=9, chunk=b"!", file_size=10) == 10
    assert path.read_bytes() == b"confirmed!"


def test_short_disk_file_returns_actual_offset_for_database_rollback(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    path = storage.file_path(JOB_ID, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"short")

    assert storage.write_chunk(JOB_ID, 0, expected_offset=9, chunk=b"!", file_size=10) == 5
    assert path.read_bytes() == b"short"


def test_rejects_empty_chunk(tmp_path: Path) -> None:
    storage = _storage(tmp_path)

    with pytest.raises(ManagedStorageError):
        storage.write_chunk(JOB_ID, 0, expected_offset=0, chunk=b"", file_size=1)


def test_rejects_oversized_chunk(tmp_path: Path) -> None:
    storage = _storage(tmp_path)

    with pytest.raises(ManagedStorageError):
        storage.write_chunk(
            JOB_ID,
            0,
            expected_offset=0,
            chunk=b"x" * (CHUNK_BYTES + 1),
            file_size=CHUNK_BYTES + 1,
        )


def test_accepts_exact_four_mib_chunk_but_rejects_file_boundary_overrun(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    chunk = b"x" * CHUNK_BYTES

    assert storage.write_chunk(JOB_ID, 0, expected_offset=0, chunk=chunk, file_size=CHUNK_BYTES) == CHUNK_BYTES
    with pytest.raises(ManagedStorageError):
        storage.write_chunk(JOB_ID, 0, expected_offset=CHUNK_BYTES, chunk=b"x", file_size=CHUNK_BYTES)


def test_fingerprint_is_stable_changes_with_metadata_and_content(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    source = tmp_path / "sample.bin"
    source.write_bytes(bytes(range(256)) * 512)

    first = storage.fingerprint(source, "study/sample.bin", source.stat().st_size, 10)
    second = storage.fingerprint(source, "study/sample.bin", source.stat().st_size, 10)
    assert first == second
    assert len(first) == 64
    assert first == first.lower()
    assert first != storage.fingerprint(source, "study/other.bin", source.stat().st_size, 10)
    assert first != storage.fingerprint(source, "study/sample.bin", source.stat().st_size, 11)

    source.write_bytes(b"z" + source.read_bytes()[1:])
    assert first != storage.fingerprint(source, "study/sample.bin", source.stat().st_size, 10)


def test_fingerprint_reads_small_file_once_and_rejects_size_mismatch(
    tmp_path: Path,
) -> None:
    storage = _storage(tmp_path)
    source = tmp_path / "small.bin"
    source.write_bytes(b"small")
    storage.fingerprint(source, "small.bin", 5, 0)

    with pytest.raises(ManagedStorageError):
        storage.fingerprint(source, "small.bin", 6, 0)


def test_cleanup_job_only_removes_safe_job_directory(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    path = storage.ensure_job_dir(JOB_ID)
    (path / "0.part").write_bytes(b"x")

    storage.cleanup_job(JOB_ID)

    assert not path.exists()
    assert storage.root.is_dir()


def test_cleanup_orphans_removes_inactive_and_preserves_active(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    active = storage.ensure_job_dir(JOB_ID)
    orphan = storage.ensure_job_dir(OTHER_JOB_ID)
    (active / "0.part").write_bytes(b"active")
    (orphan / "0.part").write_bytes(b"orphan")

    assert storage.cleanup_orphans({JOB_ID}) == 0
    assert active.is_dir()
    assert not orphan.exists()


def test_cleanup_orphans_reports_failures_and_never_deletes_active_link(
    tmp_path: Path,
) -> None:
    storage = _storage(tmp_path)
    active = storage.ensure_job_dir(JOB_ID)
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_active = storage.root / str(JOB_ID) / "linked"
    _directory_link(linked_active, outside)
    unexpected = storage.root / "unexpected.txt"
    unexpected.write_text("keep", encoding="utf-8")

    assert storage.cleanup_orphans({JOB_ID}) == 1
    assert active.is_dir()
    assert linked_active.is_symlink() or linked_active.is_junction()
    assert unexpected.read_text(encoding="utf-8") == "keep"


def test_cleanup_job_rejects_job_path_escape_and_symlink(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()

    with pytest.raises(UnsafeImportJobPathError):
        storage.cleanup_job("../outside")  # type: ignore[arg-type]

    storage.root.mkdir(parents=True)
    _directory_link(storage.root / str(JOB_ID), outside)
    with pytest.raises(UnsafeImportJobPathError):
        storage.cleanup_job(JOB_ID)
    assert outside.is_dir()
