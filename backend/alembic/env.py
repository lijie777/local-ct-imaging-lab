from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, engine_from_config, pool

from app.core.config import load_settings


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _database_url() -> str:
    command_line_url = context.get_x_argument(as_dictionary=True).get("database_url")
    configured_url = config.get_main_option("sqlalchemy.url").strip()
    return command_line_url or configured_url or load_settings().database_url


config.set_main_option("sqlalchemy.url", _database_url().replace("%", "%%"))

try:
    from app.db.base import Base
except ModuleNotFoundError as error:
    if error.name != "app.db.base":
        raise
    target_metadata = MetaData()
else:
    target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
