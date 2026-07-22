from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DATA_DIR_ENV_VAR = "MEDICAL_CT_APP_DATA_DIR"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
DATABASE_FILENAME = "patient-management.sqlite3"


def _sqlite_url(database_path: Path) -> str:
    return f"sqlite+pysqlite:///{database_path.resolve().as_posix()}"


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    database_path: Path | None
    database_url: str
    imports_dir: Path
    dicom_dir: Path
    delete_staging_dir: Path


def load_settings(
    *,
    database_url_override: str | None = None,
    data_dir_override: str | Path | None = None,
) -> Settings:
    raw_data_dir = data_dir_override or os.environ.get(DATA_DIR_ENV_VAR)
    data_dir = (
        Path(raw_data_dir).expanduser().resolve()
        if raw_data_dir
        else DEFAULT_DATA_DIR.resolve()
    )

    if database_url_override is not None:
        return Settings(
            data_dir=data_dir,
            database_path=None,
            database_url=database_url_override,
            imports_dir=data_dir / ".imports",
            dicom_dir=data_dir / "dicom",
            delete_staging_dir=data_dir / ".delete-staging",
        )

    database_path = data_dir / DATABASE_FILENAME
    return Settings(
        data_dir=data_dir,
        database_path=database_path,
        database_url=_sqlite_url(database_path),
        imports_dir=data_dir / ".imports",
        dicom_dir=data_dir / "dicom",
        delete_staging_dir=data_dir / ".delete-staging",
    )
