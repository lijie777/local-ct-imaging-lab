from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# Load mapped models so Base.metadata is complete for tests and Alembic.
from app.models import patient as _patient  # noqa: E402,F401
from app.models import study as _study  # noqa: E402,F401
from app.models import series as _series  # noqa: E402,F401
from app.models import instance as _instance  # noqa: E402,F401
from app.models import viewer_state as _viewer_state  # noqa: E402,F401
from app.models import import_job as _import_job  # noqa: E402,F401
