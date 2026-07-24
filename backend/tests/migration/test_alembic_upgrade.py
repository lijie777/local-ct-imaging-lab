from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy.exc import IntegrityError


BACKEND_ROOT = Path(__file__).resolve().parents[2]
NOW_SQL = "2026-07-23 12:00:00"


def _upgrade_empty_database(
    tmp_path: Path,
    filename: str,
) -> tuple[Inspector, Engine]:
    database_path = (tmp_path / filename).resolve()
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "head")

    engine = create_engine(database_url)
    return inspect(engine), engine


def test_upgrade_from_empty_database_creates_patients_table(tmp_path: Path) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "table.sqlite3")
    try:
        assert "patients" in inspector.get_table_names()
        column_names = {column["name"] for column in inspector.get_columns("patients")}
        assert {
            "id",
            "medical_record_no",
            "medical_record_no_normalized",
            "name",
            "sex",
            "birth_date",
            "created_at",
            "updated_at",
        } <= column_names
        assert "study_count" not in column_names
        assert "latest_study_date" not in column_names
    finally:
        engine.dispose()


def test_upgrade_creates_normalized_medical_record_number_unique_index(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "unique-index.sqlite3")
    try:
        assert "patients" in inspector.get_table_names()
        indexes = {item["name"]: item for item in inspector.get_indexes("patients")}
        unique_index = indexes["uq_patients_medical_record_no_normalized"]
        assert unique_index["unique"] == 1
        assert unique_index["column_names"] == ["medical_record_no_normalized"]
    finally:
        engine.dispose()


def test_upgrade_creates_stable_sort_index(tmp_path: Path) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "sort-index.sqlite3")
    try:
        assert "patients" in inspector.get_table_names()
        indexes = {item["name"]: item for item in inspector.get_indexes("patients")}
        stable_sort_index = indexes["ix_patients_stable_sort"]
        assert stable_sort_index["column_names"] == [
            "updated_at",
            "medical_record_no_normalized",
        ]
    finally:
        engine.dispose()


def test_upgrade_creates_sex_and_timestamp_check_constraints(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "checks.sqlite3")
    try:
        assert "patients" in inspector.get_table_names()
        constraint_names = {
            item["name"] for item in inspector.get_check_constraints("patients")
        }
        assert "ck_patients_sex" in constraint_names
        assert "ck_patients_timestamp_order" in constraint_names
    finally:
        engine.dispose()


def test_upgrade_creates_dicom_index_tables_without_pixel_blob(tmp_path: Path) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "dicom-tables.sqlite3")
    try:
        assert {"patients", "studies", "series", "instances"} <= set(
            inspector.get_table_names()
        )
        assert {
            "id",
            "patient_id",
            "study_instance_uid",
            "dicom_patient_id",
            "study_date",
            "study_time",
            "accession_number",
            "description",
            "created_at",
            "updated_at",
        } == {column["name"] for column in inspector.get_columns("studies")}
        instance_columns = {
            column["name"] for column in inspector.get_columns("instances")
        }
        assert "pixel_data" not in instance_columns
        assert "managed_path" in instance_columns
        assert "file_size" in instance_columns
    finally:
        engine.dispose()


def test_upgrade_creates_unique_uid_indexes_and_stable_list_indexes(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "dicom-indexes.sqlite3")
    try:
        study_indexes = {
            item["name"]: item for item in inspector.get_indexes("studies")
        }
        series_indexes = {
            item["name"]: item for item in inspector.get_indexes("series")
        }
        instance_indexes = {
            item["name"]: item for item in inspector.get_indexes("instances")
        }

        assert study_indexes["uq_studies_study_instance_uid"]["unique"] == 1
        assert series_indexes["uq_series_series_instance_uid"]["unique"] == 1
        assert instance_indexes["uq_instances_sop_instance_uid"]["unique"] == 1
        assert study_indexes["ix_studies_patient_sort"]["column_names"] == [
            "patient_id",
            "study_date",
            "created_at",
            "study_instance_uid",
        ]
        assert series_indexes["ix_series_study_sort"]["column_names"] == [
            "study_id",
            "series_number",
            "series_instance_uid",
        ]
        assert instance_indexes["ix_instances_series_sort"]["column_names"] == [
            "series_id",
            "instance_number",
            "sop_instance_uid",
        ]
    finally:
        engine.dispose()


def test_upgrade_creates_cascade_foreign_keys_and_viewability_constraints(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "dicom-fks.sqlite3")
    try:
        study_fk = inspector.get_foreign_keys("studies")[0]
        series_fk = inspector.get_foreign_keys("series")[0]
        instance_fk = inspector.get_foreign_keys("instances")[0]
        assert study_fk["referred_table"] == "patients"
        assert series_fk["referred_table"] == "studies"
        assert instance_fk["referred_table"] == "series"
        assert study_fk["options"].get("ondelete") == "CASCADE"
        assert series_fk["options"].get("ondelete") == "CASCADE"
        assert instance_fk["options"].get("ondelete") == "CASCADE"

        constraints = {
            item["name"] for item in inspector.get_check_constraints("series")
        }
        assert "ck_series_viewability_status" in constraints
        assert "ck_series_viewability_reason" in constraints
    finally:
        engine.dispose()


def test_application_database_enables_sqlite_foreign_keys(tmp_path: Path) -> None:
    from app.db.session import create_database

    database_path = (tmp_path / "foreign-keys.sqlite3").resolve()
    database = create_database(
        f"sqlite+pysqlite:///{database_path.as_posix()}"
    )
    try:
        with database.engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
    finally:
        database.engine.dispose()


def test_upgrade_creates_versioned_viewer_state_with_series_cascade(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "viewer-state.sqlite3")
    try:
        assert "viewer_states" in inspector.get_table_names()
        assert {column["name"] for column in inspector.get_columns("viewer_states")} == {
            "series_id",
            "schema_version",
            "payload",
            "created_at",
            "updated_at",
        }
        assert inspector.get_pk_constraint("viewer_states")["constrained_columns"] == [
            "series_id"
        ]
        foreign_key = inspector.get_foreign_keys("viewer_states")[0]
        assert foreign_key["referred_table"] == "series"
        assert foreign_key["constrained_columns"] == ["series_id"]
        assert foreign_key["options"].get("ondelete") == "CASCADE"
        constraints = {
            item["name"] for item in inspector.get_check_constraints("viewer_states")
        }
        assert constraints == {
            "ck_viewer_states_schema_version",
            "ck_viewer_states_timestamp_order",
        }
    finally:
        engine.dispose()


def test_upgrade_creates_import_job_tables_with_cascades_and_uniqueness(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "import-jobs.sqlite3")
    try:
        assert {"import_jobs", "import_job_files"} <= set(
            inspector.get_table_names()
        )
        assert {
            "id",
            "patient_id",
            "status",
            "active_slot",
            "total_files",
            "total_bytes",
            "uploaded_bytes",
            "report",
            "error_code",
            "error_message",
            "created_at",
            "updated_at",
            "started_at",
            "completed_at",
        } == {column["name"] for column in inspector.get_columns("import_jobs")}
        assert {
            "id",
            "job_id",
            "ordinal",
            "relative_path",
            "size_bytes",
            "last_modified_ms",
            "resume_fingerprint",
            "confirmed_offset",
        } == {
            column["name"]
            for column in inspector.get_columns("import_job_files")
        }
        job_columns = {
            column["name"]: column
            for column in inspector.get_columns("import_jobs")
        }
        file_columns = {
            column["name"]: column
            for column in inspector.get_columns("import_job_files")
        }
        assert str(job_columns["id"]["type"]) == "CHAR(32)"
        assert job_columns["id"]["nullable"] is False
        assert str(job_columns["status"]["type"]) == "VARCHAR(16)"
        assert job_columns["status"]["nullable"] is False
        assert str(job_columns["active_slot"]["type"]) == "INTEGER"
        assert job_columns["active_slot"]["nullable"] is True
        assert str(job_columns["total_files"]["type"]) == "INTEGER"
        assert job_columns["total_files"]["nullable"] is False
        for column_name in ("total_bytes", "uploaded_bytes"):
            assert str(job_columns[column_name]["type"]) == "BIGINT"
            assert job_columns[column_name]["nullable"] is False
        assert str(job_columns["report"]["type"]) == "JSON"
        assert job_columns["report"]["nullable"] is True
        for column_name in ("started_at", "completed_at"):
            assert str(job_columns[column_name]["type"]) == "DATETIME"
            assert job_columns[column_name]["nullable"] is True

        assert str(file_columns["id"]["type"]) == "CHAR(32)"
        assert file_columns["id"]["nullable"] is False
        assert str(file_columns["ordinal"]["type"]) == "INTEGER"
        assert file_columns["ordinal"]["nullable"] is False
        assert str(file_columns["relative_path"]["type"]) == "VARCHAR(1024)"
        assert file_columns["relative_path"]["nullable"] is False
        assert str(file_columns["resume_fingerprint"]["type"]) == "VARCHAR(64)"
        assert file_columns["resume_fingerprint"]["nullable"] is False
        for column_name in (
            "size_bytes",
            "last_modified_ms",
            "confirmed_offset",
        ):
            assert str(file_columns[column_name]["type"]) == "BIGINT"
            assert file_columns[column_name]["nullable"] is False

        job_foreign_key = inspector.get_foreign_keys("import_jobs")[0]
        file_foreign_key = inspector.get_foreign_keys("import_job_files")[0]
        assert job_foreign_key["referred_table"] == "patients"
        assert job_foreign_key["constrained_columns"] == ["patient_id"]
        assert job_foreign_key["options"].get("ondelete") == "CASCADE"
        assert file_foreign_key["referred_table"] == "import_jobs"
        assert file_foreign_key["constrained_columns"] == ["job_id"]
        assert file_foreign_key["options"].get("ondelete") == "CASCADE"

        job_unique_constraints = {
            item["name"]: item
            for item in inspector.get_unique_constraints("import_jobs")
        }
        file_unique_constraints = {
            item["name"]: item
            for item in inspector.get_unique_constraints("import_job_files")
        }
        assert job_unique_constraints["uq_import_jobs_patient_active"][
            "column_names"
        ] == ["patient_id", "active_slot"]
        assert file_unique_constraints["uq_import_job_files_job_ordinal"][
            "column_names"
        ] == ["job_id", "ordinal"]
        assert file_unique_constraints["uq_import_job_files_job_relative_path"][
            "column_names"
        ] == ["job_id", "relative_path"]
    finally:
        engine.dispose()


def test_upgrade_creates_import_job_state_progress_and_time_checks(
    tmp_path: Path,
) -> None:
    inspector, engine = _upgrade_empty_database(tmp_path, "import-job-checks.sqlite3")
    try:
        job_constraints = {
            item["name"]
            for item in inspector.get_check_constraints("import_jobs")
        }
        file_constraints = {
            item["name"]
            for item in inspector.get_check_constraints("import_job_files")
        }
        assert {
            "ck_import_jobs_status_active_slot",
            "ck_import_jobs_total_files",
            "ck_import_jobs_total_bytes",
            "ck_import_jobs_uploaded_bytes",
            "ck_import_jobs_timestamp_order",
            "ck_import_jobs_started_at_order",
            "ck_import_jobs_completed_at_order",
            "ck_import_jobs_completed_at_status",
        } <= job_constraints
        assert {
            "ck_import_job_files_ordinal",
            "ck_import_job_files_size_bytes",
            "ck_import_job_files_last_modified_ms",
            "ck_import_job_files_confirmed_offset",
        } <= file_constraints
    finally:
        engine.dispose()


def test_upgrade_import_job_checks_reject_invalid_rows(tmp_path: Path) -> None:
    _, engine = _upgrade_empty_database(tmp_path, "import-job-invalid.sqlite3")
    patient_insert = text(
        "INSERT INTO patients ("
        "id, medical_record_no, medical_record_no_normalized, name, sex, "
        "birth_date, created_at, updated_at"
        ") VALUES ("
        ":id, :medical_record_no, :medical_record_no_normalized, :name, "
        "'unknown', NULL, :created_at, :updated_at"
        ")"
    )
    job_insert = text(
        "INSERT INTO import_jobs ("
        "id, patient_id, status, active_slot, total_files, total_bytes, "
        "uploaded_bytes, report, error_code, error_message, created_at, "
        "updated_at, started_at, completed_at"
        ") VALUES ("
        ":id, :patient_id, :status, :active_slot, 1, 10, 0, NULL, NULL, "
        "NULL, :created_at, :updated_at, :started_at, :completed_at"
        ")"
    )
    file_insert = text(
        "INSERT INTO import_job_files ("
        "id, job_id, ordinal, relative_path, size_bytes, last_modified_ms, "
        "resume_fingerprint, confirmed_offset"
        ") VALUES ("
        ":id, :job_id, 0, 'image.dcm', 10, 0, :resume_fingerprint, "
        ":confirmed_offset"
        ")"
    )
    try:
        patient_ids = [f"{number:032x}" for number in range(1, 5)]
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            for ordinal, patient_id in enumerate(patient_ids, start=1):
                connection.execute(
                    patient_insert,
                    {
                        "id": patient_id,
                        "medical_record_no": f"MR-{ordinal}",
                        "medical_record_no_normalized": f"mr-{ordinal}",
                        "name": f"Patient {ordinal}",
                        "created_at": NOW_SQL,
                        "updated_at": NOW_SQL,
                    },
                )
            connection.execute(
                job_insert,
                {
                    "id": "10000000000000000000000000000000",
                    "patient_id": patient_ids[0],
                    "status": "uploading",
                    "active_slot": 1,
                    "created_at": NOW_SQL,
                    "updated_at": NOW_SQL,
                    "started_at": None,
                    "completed_at": None,
                },
            )

        invalid_jobs = [
            {
                "id": "20000000000000000000000000000000",
                "patient_id": patient_ids[1],
                "status": "uploading",
                "active_slot": None,
                "created_at": NOW_SQL,
                "updated_at": NOW_SQL,
                "started_at": None,
                "completed_at": None,
            },
            {
                "id": "30000000000000000000000000000000",
                "patient_id": patient_ids[2],
                "status": "running",
                "active_slot": 1,
                "created_at": NOW_SQL,
                "updated_at": NOW_SQL,
                "started_at": "2026-07-23 12:00:01",
                "completed_at": None,
            },
        ]
        for parameters in invalid_jobs:
            with pytest.raises(IntegrityError):
                with engine.begin() as connection:
                    connection.execute(text("PRAGMA foreign_keys=ON"))
                    connection.execute(job_insert, parameters)

        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(text("PRAGMA foreign_keys=ON"))
                connection.execute(
                    file_insert,
                    {
                        "id": "40000000000000000000000000000000",
                        "job_id": "10000000000000000000000000000000",
                        "resume_fingerprint": "a" * 64,
                        "confirmed_offset": 11,
                    },
                )
    finally:
        engine.dispose()
