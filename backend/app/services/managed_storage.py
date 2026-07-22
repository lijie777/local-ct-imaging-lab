from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import shutil
from collections.abc import Sequence
from uuid import UUID, uuid4

from app.core.config import Settings
from app.services.dicom_parser import DicomMetadata


UID_SEGMENT = re.compile(r"^[0-9]+(?:\.[0-9]+)*$")


class ManagedStorageError(Exception):
    pass


class UnsafeManagedPathError(ManagedStorageError):
    pass


class StorageConflictError(ManagedStorageError):
    pass


@dataclass(frozen=True, slots=True)
class StoredFile:
    path: Path
    file_size: int


@dataclass(frozen=True, slots=True)
class StagedPatientDirectory:
    patient_id: UUID
    original_path: Path
    staged_path: Path | None


@dataclass(slots=True)
class ImportSession:
    path: Path

    def file_path(self, index: int) -> Path:
        target = self.path / f"{index:08d}.upload"
        target.resolve().relative_to(self.path.resolve())
        return target

    def cleanup(self) -> None:
        if self.path.exists():
            shutil.rmtree(self.path)


class ManagedStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.data_dir = settings.data_dir.resolve()
        self.imports_dir = settings.imports_dir.resolve()
        self.dicom_dir = settings.dicom_dir.resolve()
        self.delete_staging_dir = settings.delete_staging_dir.absolute()

    @staticmethod
    def _validate_uid_segment(value: str) -> str:
        if len(value) > 64 or UID_SEGMENT.fullmatch(value) is None:
            raise UnsafeManagedPathError("Unsafe DICOM UID path segment")
        return value

    @staticmethod
    def _ensure_within(path: Path, root: Path) -> Path:
        resolved = path.resolve()
        try:
            resolved.relative_to(root.resolve())
        except ValueError as error:
            raise UnsafeManagedPathError("Managed path leaves configured root") from error
        return resolved

    def _validate_delete_staging_dir(self, *, create: bool) -> Path | None:
        root = self.delete_staging_dir
        try:
            root.lstat()
        except FileNotFoundError:
            if not create:
                return None
            try:
                self._ensure_within(root, self.data_dir)
                root.mkdir(parents=True, exist_ok=True)
                root.lstat()
            except UnsafeManagedPathError:
                raise
            except OSError as error:
                raise ManagedStorageError(
                    "Unable to create patient delete staging directory"
                ) from error
        except OSError as error:
            raise ManagedStorageError(
                "Unable to validate patient delete staging directory"
            ) from error

        try:
            if root.is_symlink() or root.is_junction() or not root.is_dir():
                raise UnsafeManagedPathError(
                    "Unsafe patient delete staging directory"
                )
            self._ensure_within(root, self.data_dir)
        except UnsafeManagedPathError:
            raise
        except OSError as error:
            raise ManagedStorageError(
                "Unable to validate patient delete staging directory"
            ) from error
        return root

    def _validate_staged_patient_directory(
        self,
        staged_path: Path,
        root: Path | None,
    ) -> Path | None:
        try:
            staged_path.lstat()
        except FileNotFoundError:
            return None
        except OSError as error:
            raise ManagedStorageError(
                "Unable to inspect staged patient DICOM directory"
            ) from error

        if root is None:
            raise UnsafeManagedPathError(
                "Staged patient DICOM directory has no staging root"
            )

        try:
            if (
                staged_path.is_symlink()
                or staged_path.is_junction()
                or not staged_path.is_dir()
            ):
                raise UnsafeManagedPathError(
                    "Unsafe staged patient DICOM directory"
                )
            safe_path = self._ensure_within(staged_path, root)
            if safe_path == root.resolve():
                raise UnsafeManagedPathError(
                    "Staged patient DICOM directory must be below staging root"
                )
        except UnsafeManagedPathError:
            raise
        except OSError as error:
            raise ManagedStorageError(
                "Unable to validate staged patient DICOM directory"
            ) from error
        return safe_path

    def create_import_session(self) -> ImportSession:
        self.imports_dir.mkdir(parents=True, exist_ok=True)
        path = self._ensure_within(
            self.imports_dir / str(uuid4()), self.imports_dir
        )
        path.mkdir()
        return ImportSession(path)

    def patient_directory(self, patient_id: UUID) -> Path:
        return self._ensure_within(self.dicom_dir / str(patient_id), self.dicom_dir)

    def target_path(self, patient_id: UUID, metadata: DicomMetadata) -> Path:
        study_uid = self._validate_uid_segment(metadata.study_instance_uid)
        series_uid = self._validate_uid_segment(metadata.series_instance_uid)
        sop_uid = self._validate_uid_segment(metadata.sop_instance_uid)
        return self._ensure_within(
            self.patient_directory(patient_id)
            / study_uid
            / series_uid
            / f"{sop_uid}.dcm",
            self.dicom_dir,
        )

    def resolve_dicom_file(self, managed_path: str) -> Path:
        relative = Path(managed_path)
        if relative.is_absolute():
            raise UnsafeManagedPathError("Managed DICOM path must be relative")
        return self._ensure_within(self.data_dir / relative, self.dicom_dir)

    def store_new(self, source: Path, target: Path) -> StoredFile:
        target = self._ensure_within(target, self.dicom_dir)
        if target.exists():
            raise StorageConflictError("Managed target already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._ensure_within(
            target.with_name(f".{target.name}.{uuid4()}.part"), self.dicom_dir
        )
        try:
            shutil.copyfile(source, temporary)
            os.replace(temporary, target)
        except OSError as error:
            temporary.unlink(missing_ok=True)
            raise ManagedStorageError("Unable to store managed DICOM file") from error
        return StoredFile(path=target, file_size=target.stat().st_size)

    def cleanup_paths(self, paths: Sequence[Path]) -> None:
        for target in reversed(paths):
            path = self._ensure_within(target, self.dicom_dir)
            path.unlink(missing_ok=True)
            parent = path.parent
            while parent != self.dicom_dir and parent.exists():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent

    def cleanup_created(self, files: Sequence[StoredFile]) -> None:
        self.cleanup_paths([stored.path for stored in files])

    def stage_patient_delete(self, patient_id: UUID) -> StagedPatientDirectory:
        original = self.patient_directory(patient_id)
        if not original.exists():
            return StagedPatientDirectory(patient_id, original, None)
        staging_root = self._validate_delete_staging_dir(create=True)
        if staging_root is None:
            raise ManagedStorageError(
                "Unable to create patient delete staging directory"
            )
        try:
            staged_candidate = staging_root / f"{patient_id}-{uuid4()}"
            existing_staged = self._validate_staged_patient_directory(
                staged_candidate,
                staging_root,
            )
            if existing_staged is not None:
                raise StorageConflictError(
                    "Patient delete staging target already exists"
                )
            staged = self._ensure_within(
                staged_candidate,
                staging_root,
            )
            os.replace(original, staged)
        except UnsafeManagedPathError:
            raise
        except OSError as error:
            raise ManagedStorageError("Unable to stage patient DICOM deletion") from error
        return StagedPatientDirectory(patient_id, original, staged)

    def restore_patient_delete(self, staged: StagedPatientDirectory) -> None:
        if staged.staged_path is None:
            return
        staging_root = self._validate_delete_staging_dir(create=False)
        safe_staged_path = self._validate_staged_patient_directory(
            staged.staged_path,
            staging_root,
        )
        if safe_staged_path is None:
            return
        try:
            original_path = self._ensure_within(
                staged.original_path,
                self.dicom_dir,
            )
        except UnsafeManagedPathError:
            raise
        except OSError as error:
            raise ManagedStorageError(
                "Unable to validate patient DICOM directory"
            ) from error
        try:
            if original_path.exists():
                raise StorageConflictError(
                    "Patient DICOM directory already exists"
                )
            original_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(safe_staged_path, original_path)
        except StorageConflictError:
            raise
        except OSError as error:
            raise ManagedStorageError("Unable to restore patient DICOM directory") from error

    def purge_patient_delete(self, staged: StagedPatientDirectory) -> None:
        if staged.staged_path is None:
            return
        staging_root = self._validate_delete_staging_dir(create=False)
        safe_staged_path = self._validate_staged_patient_directory(
            staged.staged_path,
            staging_root,
        )
        if safe_staged_path is None:
            return
        try:
            shutil.rmtree(safe_staged_path)
        except OSError as error:
            raise ManagedStorageError("Unable to purge patient DICOM directory") from error

    def cleanup_pending_patient_deletes(self) -> int:
        try:
            staging_root = self._validate_delete_staging_dir(create=False)
        except ManagedStorageError:
            return 1
        if staging_root is None:
            return 0

        try:
            # stage_patient_delete exclusively populates this internal
            # quarantine; startup cleanup intentionally considers only its
            # direct children.
            entries = sorted(
                staging_root.iterdir(),
                key=lambda entry: entry.name,
            )
        except FileNotFoundError:
            return 0
        except OSError:
            return 1

        failed = 0
        for entry in entries:
            try:
                safe_directory = self._validate_staged_patient_directory(
                    entry,
                    staging_root,
                )
                if safe_directory is None:
                    continue
                shutil.rmtree(safe_directory)
            except (ManagedStorageError, OSError):
                failed += 1

        return failed
