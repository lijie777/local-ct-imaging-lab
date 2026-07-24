from __future__ import annotations

from collections.abc import Iterable
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
from uuid import UUID

from app.core.config import Settings
from app.services.managed_storage import ManagedStorageError


CHUNK_BYTES = 4 * 1024 * 1024
FINGERPRINT_SAMPLE_BYTES = 32 * 1024
MAX_ORDINAL = 1_999


class ImportJobStorageError(ManagedStorageError):
    """Base error for resumable import staging operations."""


class UnsafeImportJobPathError(ImportJobStorageError):
    """Raised when an import-job path is outside its managed boundary."""


class ImportJobFileMismatchError(ImportJobStorageError):
    """Raised when staged content does not match its declared file metadata."""


class ImportJobStorage:
    """Safe, resumable storage for one import job's ordered file chunks."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.data_dir = settings.data_dir.resolve()
        # Keep the configured path un-resolved until validation so a symlinked
        # root can be rejected instead of silently followed.
        self.root = settings.import_jobs_dir.absolute()
        self.import_jobs_dir = self.root

    @staticmethod
    def _uuid(value: UUID | str) -> UUID:
        if isinstance(value, UUID):
            return value
        if not isinstance(value, str):
            raise UnsafeImportJobPathError("Invalid import job path")
        try:
            parsed = UUID(value)
        except (ValueError, AttributeError) as error:
            raise UnsafeImportJobPathError("Invalid import job path") from error
        return parsed

    @staticmethod
    def _ordinal(value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise UnsafeImportJobPathError("Invalid import file path")
        if value < 0 or value > MAX_ORDINAL:
            raise UnsafeImportJobPathError("Invalid import file path")
        return value

    @staticmethod
    def _is_link(path: Path) -> bool:
        return path.is_symlink() or path.is_junction()

    @staticmethod
    def _contained(path: Path, root: Path, *, message: str) -> Path:
        resolved = path.resolve()
        try:
            resolved.relative_to(root.resolve())
        except ValueError as error:
            raise UnsafeImportJobPathError(message) from error
        return resolved

    def _validate_root(self, *, create: bool) -> Path | None:
        root = self.root
        try:
            root.lstat()
        except FileNotFoundError:
            if not create:
                return None
            try:
                self._contained(
                    root,
                    self.data_dir,
                    message="Import job storage leaves configured data directory",
                )
                root.mkdir(parents=True, exist_ok=True)
                root.lstat()
            except UnsafeImportJobPathError:
                raise
            except OSError as error:
                raise ImportJobStorageError(
                    "Unable to create import job storage directory"
                ) from error
        except OSError as error:
            raise ImportJobStorageError(
                "Unable to inspect import job storage directory"
            ) from error

        try:
            if self._is_link(root) or not root.is_dir():
                raise UnsafeImportJobPathError("Unsafe import job storage directory")
            safe_root = self._contained(
                root,
                self.data_dir,
                message="Import job storage leaves configured data directory",
            )
            if safe_root == self.data_dir:
                raise UnsafeImportJobPathError(
                    "Import job storage directory must be below data directory"
                )
        except UnsafeImportJobPathError:
            raise
        except OSError as error:
            raise ImportJobStorageError(
                "Unable to validate import job storage directory"
            ) from error
        return safe_root

    def _job_directory(self, job_id: UUID | str, *, create: bool) -> Path | None:
        parsed_job_id = self._uuid(job_id)
        root = self._validate_root(create=create)
        if root is None:
            return None
        candidate = self.root / str(parsed_job_id)
        try:
            candidate.lstat()
        except FileNotFoundError:
            if not create:
                return None
            try:
                self._contained(
                    candidate,
                    root,
                    message="Import job directory leaves managed root",
                )
                candidate.mkdir()
                candidate.lstat()
            except UnsafeImportJobPathError:
                raise
            except FileExistsError:
                # Re-check the raced target below; a symlink must never be
                # followed after another process creates it.
                pass
            except OSError as error:
                raise ImportJobStorageError(
                    "Unable to create import job directory"
                ) from error
        except OSError as error:
            raise ImportJobStorageError(
                "Unable to inspect import job directory"
            ) from error

        try:
            if self._is_link(candidate) or not candidate.is_dir():
                raise UnsafeImportJobPathError("Unsafe import job directory")
            safe_candidate = self._contained(
                candidate,
                root,
                message="Import job directory leaves managed root",
            )
            if safe_candidate == root:
                raise UnsafeImportJobPathError("Invalid import job directory")
        except UnsafeImportJobPathError:
            raise
        except OSError as error:
            raise ImportJobStorageError(
                "Unable to validate import job directory"
            ) from error
        return safe_candidate

    def ensure_job_dir(self, job_id: UUID | str) -> Path:
        path = self._job_directory(job_id, create=True)
        if path is None:  # pragma: no cover - create=True always returns a path
            raise ImportJobStorageError("Unable to create import job directory")
        return path

    def job_directory(self, job_id: UUID | str) -> Path:
        return self.ensure_job_dir(job_id)

    def file_path(self, job_id: UUID | str, ordinal: int) -> Path:
        parsed_ordinal = self._ordinal(ordinal)
        job_dir = self.ensure_job_dir(job_id)
        candidate = job_dir / f"{parsed_ordinal}.part"
        try:
            self._contained(
                candidate,
                self.root,
                message="Import job file leaves managed root",
            )
            try:
                candidate_stat = candidate.lstat()
            except FileNotFoundError:
                # A normal missing file is created on the first chunk write.
                return candidate
            if self._is_link(candidate) or not stat.S_ISREG(candidate_stat.st_mode):
                raise UnsafeImportJobPathError("Unsafe import job file")
        except UnsafeImportJobPathError:
            raise
        except OSError as error:
            raise ImportJobStorageError("Unable to validate import job file") from error
        return candidate

    def write_chunk(
        self,
        job_id: UUID | str,
        ordinal: int,
        expected_offset: int,
        chunk: bytes | bytearray | memoryview,
        file_size: int | None = None,
        *,
        size_bytes: int | None = None,
    ) -> int:
        """Write one sequential chunk and return the newly confirmed offset.

        ``expected_offset`` is the SQLite confirmed offset supplied by the
        caller.  A short disk file is reported as-is so the caller can roll
        the database offset back before retrying.  A long disk tail is
        truncated to the confirmed offset before writing.
        """
        if isinstance(expected_offset, bool) or not isinstance(expected_offset, int):
            raise ImportJobStorageError("Invalid upload offset")
        if expected_offset < 0:
            raise ImportJobStorageError("Invalid upload offset")
        if size_bytes is not None:
            if file_size is not None and file_size != size_bytes:
                raise ImportJobStorageError("Conflicting file size")
            file_size = size_bytes
        if file_size is not None:
            if isinstance(file_size, bool) or not isinstance(file_size, int) or file_size < 1:
                raise ImportJobStorageError("Invalid file size")
            if expected_offset > file_size:
                raise ImportJobStorageError("Upload offset exceeds file size")

        if not isinstance(chunk, (bytes, bytearray, memoryview)):
            raise ImportJobStorageError("Upload chunk must be bytes")
        chunk_bytes = bytes(chunk)
        if not chunk_bytes or len(chunk_bytes) > CHUNK_BYTES:
            raise ImportJobStorageError("Upload chunk size is invalid")
        if file_size is not None and expected_offset + len(chunk_bytes) > file_size:
            raise ImportJobStorageError("Upload chunk exceeds file size")

        path = self.file_path(job_id, ordinal)
        try:
            try:
                actual_offset = path.stat().st_size
            except FileNotFoundError:
                actual_offset = 0

            if actual_offset < expected_offset:
                return actual_offset

            mode = "r+b" if path.exists() else "w+b"
            with path.open(mode) as handle:
                if actual_offset > expected_offset:
                    handle.truncate(expected_offset)
                    handle.flush()
                    os.fsync(handle.fileno())
                    actual_offset = expected_offset
                if actual_offset != expected_offset:
                    raise ImportJobStorageError("Upload offset does not match disk")
                handle.seek(expected_offset)
                handle.write(chunk_bytes)
                handle.flush()
                os.fsync(handle.fileno())
            return expected_offset + len(chunk_bytes)
        except ImportJobStorageError:
            raise
        except OSError as error:
            raise ImportJobStorageError("Unable to write import job chunk") from error

    def fingerprint(
        self,
        path: Path,
        relative_path: str,
        size_bytes: int,
        last_modified_ms: int,
    ) -> str:
        """Compute the browser-compatible metadata + edge-sample SHA-256."""
        if not isinstance(path, Path):
            path = Path(path)
        if (
            isinstance(size_bytes, bool)
            or not isinstance(size_bytes, int)
            or size_bytes < 0
            or isinstance(last_modified_ms, bool)
            or not isinstance(last_modified_ms, int)
            or last_modified_ms < 0
            or not isinstance(relative_path, str)
        ):
            raise ImportJobFileMismatchError("Invalid fingerprint metadata")
        try:
            stat = path.lstat()
        except OSError as error:
            raise ImportJobFileMismatchError("Unable to inspect fingerprint source") from error
        if self._is_link(path) or not path.is_file():
            raise ImportJobFileMismatchError("Fingerprint source is not a regular file")
        if stat.st_size != size_bytes:
            raise ImportJobFileMismatchError("Fingerprint source size differs")

        metadata = json.dumps(
            {
                "relative_path": relative_path,
                "size": size_bytes,
                "last_modified_ms": last_modified_ms,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        digest = hashlib.sha256()
        digest.update(metadata)
        try:
            with path.open("rb") as handle:
                if size_bytes <= 2 * FINGERPRINT_SAMPLE_BYTES:
                    # One read for small files avoids reading the same bytes
                    # twice as both the head and tail sample.
                    digest.update(handle.read())
                else:
                    digest.update(handle.read(FINGERPRINT_SAMPLE_BYTES))
                    handle.seek(-FINGERPRINT_SAMPLE_BYTES, os.SEEK_END)
                    digest.update(handle.read(FINGERPRINT_SAMPLE_BYTES))
        except OSError as error:
            raise ImportJobFileMismatchError("Unable to read fingerprint source") from error
        return digest.hexdigest()

    compute_fingerprint = fingerprint
    fingerprint_file = fingerprint

    def cleanup_job(self, job_id: UUID | str) -> None:
        # Validate caller input even when the configured root is absent; an
        # invalid user-supplied identifier must never turn into a silent no-op.
        self._uuid(job_id)
        root = self._validate_root(create=False)
        if root is None:
            return
        job_dir = self._job_directory(job_id, create=False)
        if job_dir is None:
            return
        try:
            shutil.rmtree(job_dir)
        except OSError as error:
            raise ImportJobStorageError("Unable to clean import job directory") from error

    def cleanup_orphans(self, active_job_ids: Iterable[UUID | str]) -> int:
        root = self._validate_root(create=False)
        if root is None:
            return 0
        active = {str(self._uuid(job_id)) for job_id in active_job_ids}
        try:
            entries = sorted(root.iterdir(), key=lambda item: item.name)
        except FileNotFoundError:
            return 0
        except OSError as error:
            raise ImportJobStorageError("Unable to enumerate import job storage") from error

        failed = 0
        for entry in entries:
            try:
                if self._is_link(entry) or not entry.is_dir():
                    raise UnsafeImportJobPathError("Unsafe import job orphan entry")
                safe_entry = self._contained(
                    entry,
                    root,
                    message="Import job orphan leaves managed root",
                )
                if entry.name in active:
                    continue
                shutil.rmtree(safe_entry)
            except (ImportJobStorageError, OSError):
                failed += 1
        return failed


# A concise alias mirrors the existing managed-storage naming style for
# callers that prefer the service-specific class name.
ImportJobManagedStorage = ImportJobStorage
