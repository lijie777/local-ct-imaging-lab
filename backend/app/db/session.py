from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import load_settings


@dataclass(frozen=True, slots=True)
class Database:
    engine: Engine
    session_factory: sessionmaker[Session]


def create_database(database_url: str | None = None) -> Database:
    settings = load_settings(database_url_override=database_url)
    if settings.database_path is not None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    session_factory = sessionmaker(
        bind=engine,
        class_=Session,
        autoflush=False,
        expire_on_commit=False,
    )
    return Database(engine=engine, session_factory=session_factory)


default_database = create_database()
engine = default_database.engine
SessionLocal = default_database.session_factory


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
