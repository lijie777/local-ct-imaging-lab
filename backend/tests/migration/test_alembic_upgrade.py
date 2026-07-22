from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.engine.reflection import Inspector


BACKEND_ROOT = Path(__file__).resolve().parents[2]


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
