from __future__ import annotations

from pathlib import Path

from app.db.session import create_database


def test_committed_patient_survives_engine_and_session_factory_restart(
    tmp_path: Path,
) -> None:
    from app.db.base import Base
    from app.schemas.patient import PatientCreate
    from app.services.patient_service import create_patient, get_patient

    database_path = (tmp_path / "restart-persistence.sqlite3").resolve()
    database_url = f"sqlite+pysqlite:///{database_path.as_posix()}"

    first_database = create_database(database_url)
    try:
        Base.metadata.create_all(first_database.engine)
        with first_database.session_factory() as first_session:
            created = create_patient(
                first_session,
                PatientCreate(
                    medical_record_no="MR-PERSIST-01",
                    name="重启持久化演示",
                    sex="other",
                    birth_date="1985-06-07",
                ),
            )
            patient_id = created.id
    finally:
        first_database.engine.dispose()

    second_database = create_database(database_url)
    try:
        with second_database.session_factory() as second_session:
            restored = get_patient(second_session, patient_id)

        assert restored.id == patient_id
        assert restored.medical_record_no == "MR-PERSIST-01"
        assert restored.name == "重启持久化演示"
        assert restored.sex == "other"
        assert str(restored.birth_date) == "1985-06-07"
        assert restored.study_count == 0
        assert restored.latest_study_date is None
    finally:
        second_database.engine.dispose()
