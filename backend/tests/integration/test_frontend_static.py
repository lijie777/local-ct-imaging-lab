from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.main import create_app
from app.services.managed_storage import ManagedStorage


def test_frontend_dist_is_served_without_shadowing_api(
    tmp_path: Path,
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
) -> None:
    frontend_dist = tmp_path / "dist"
    assets = frontend_dist / "assets"
    assets.mkdir(parents=True)
    (frontend_dist / "index.html").write_text(
        "<!doctype html><title>Local CT UI</title>",
        encoding="utf-8",
    )
    (assets / "app.js").write_text(
        "window.localCtLoaded = true",
        encoding="utf-8",
    )
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
        frontend_dist_override=frontend_dist,
    )

    with TestClient(application) as client:
        root_response = client.get("/")
        asset_response = client.get("/assets/app.js")
        api_response = client.get("/api/patients")

    assert root_response.status_code == 200
    assert "Local CT UI" in root_response.text
    assert asset_response.status_code == 200
    assert asset_response.text == "window.localCtLoaded = true"
    assert api_response.status_code == 200
    assert api_response.json() == []


def test_missing_frontend_dist_does_not_block_backend_startup(
    tmp_path: Path,
    session_factory: sessionmaker[Session],
    managed_storage: ManagedStorage,
) -> None:
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
        frontend_dist_override=tmp_path / "missing-dist",
    )

    with TestClient(application) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/patients").status_code == 200
