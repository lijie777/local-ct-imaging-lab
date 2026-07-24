from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.core.config import load_settings
from app.db.session import create_database
from app.main import create_app
from app.services.managed_storage import ManagedStorage


BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_startup_migrates_existing_002_database_before_worker(
    tmp_path: Path,
    caplog,
) -> None:
    settings = load_settings(data_dir_override=tmp_path / "data")
    settings.data_dir.mkdir(parents=True)
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(alembic_config, "002_create_dicom_index")

    database = create_database(settings.database_url)
    try:
        host_logger = logging.getLogger("local_ct_startup_host")
        host_logger.disabled = False
        with database.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO patients ("
                    "id, medical_record_no, medical_record_no_normalized, name, sex, "
                    "birth_date, created_at, updated_at"
                    ") VALUES ("
                    ":id, :medical_record_no, :normalized, :name, 'unknown', NULL, "
                    ":created_at, :updated_at"
                    ")"
                ),
                {
                    "id": "10000000000000000000000000000000",
                    "medical_record_no": "MR-STARTUP-MIGRATION",
                    "normalized": "mr-startup-migration",
                    "name": "Migration Patient",
                    "created_at": "2026-07-24 13:30:00",
                    "updated_at": "2026-07-24 13:30:00",
                },
            )

        application = create_app(
            session_factory=database.session_factory,
            managed_storage=ManagedStorage(settings),
            frontend_dist_override=tmp_path / "missing-dist",
            auto_migrate=True,
        )

        with caplog.at_level(logging.WARNING):
            with TestClient(application) as client:
                response = client.get("/api/patients")

        assert response.status_code == 200
        assert [item["medical_record_no"] for item in response.json()] == [
            "MR-STARTUP-MIGRATION"
        ]
        inspector = inspect(database.engine)
        assert {"viewer_states", "import_jobs", "import_job_files"} <= set(
            inspector.get_table_names()
        )
        with database.engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                "004_create_import_jobs"
            )
        assert "Import worker startup recovery could not complete" not in caplog.text
        assert "Import worker could not claim the next job" not in caplog.text
        assert host_logger.disabled is False
    finally:
        database.engine.dispose()
