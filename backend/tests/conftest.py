from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import MetaData
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import register_error_handlers
from app.db.session import Database, create_database
from app.main import create_app
from app.core.config import load_settings
from app.services.managed_storage import ManagedStorage


def _application_metadata() -> MetaData | None:
    try:
        from app.db.base import Base
    except ModuleNotFoundError as error:
        if error.name != "app.db.base":
            raise
        return None
    return Base.metadata


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    database_path = (tmp_path / "patient-management-test.sqlite3").resolve()
    return f"sqlite+pysqlite:///{database_path.as_posix()}"


@pytest.fixture
def database(database_url: str) -> Iterator[Database]:
    database = create_database(database_url)
    metadata = _application_metadata()
    if metadata is not None:
        metadata.create_all(database.engine)

    yield database

    if metadata is not None:
        metadata.drop_all(database.engine)
    database.engine.dispose()


@pytest.fixture
def session_factory(database: Database) -> sessionmaker[Session]:
    return database.session_factory


@pytest.fixture
def managed_storage(tmp_path: Path) -> ManagedStorage:
    return ManagedStorage(load_settings(data_dir_override=tmp_path / "runtime-data"))


@pytest.fixture
def db_session(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as session:
        yield session
        session.rollback()


@pytest.fixture
def application(
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
) -> FastAPI:
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )
    register_error_handlers(application)
    return application


@pytest.fixture
def client(application: FastAPI) -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client
