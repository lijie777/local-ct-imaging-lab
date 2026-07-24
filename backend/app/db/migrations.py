from __future__ import annotations

from alembic import command
from alembic.config import Config

from app.core.config import PROJECT_ROOT


BACKEND_ROOT = PROJECT_ROOT / "backend"


def upgrade_database_schema(database_url: str) -> None:
    alembic_config = Config()
    alembic_config.set_main_option(
        "script_location",
        str(BACKEND_ROOT / "alembic"),
    )
    alembic_config.set_main_option(
        "sqlalchemy.url",
        database_url.replace("%", "%%"),
    )
    command.upgrade(alembic_config, "head")


__all__ = ["upgrade_database_schema"]
