from __future__ import annotations

from pathlib import Path
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    InstanceNotFoundError,
    ManagedDicomFileMissingError,
    PersistenceError,
    SeriesNotViewableError,
)
from app.models.instance import Instance
from app.services.managed_storage import ManagedStorage, ManagedStorageError


def get_viewable_instance_file(
    session: Session,
    storage: ManagedStorage,
    instance_id: UUID,
) -> Path:
    try:
        instance = session.get(Instance, instance_id)
        if instance is None:
            raise InstanceNotFoundError()
        if instance.series.viewability_status != "eligible":
            raise SeriesNotViewableError()
        path = storage.resolve_dicom_file(instance.managed_path)
        if not path.is_file():
            raise ManagedDicomFileMissingError()
        return path
    except (
        InstanceNotFoundError,
        ManagedDicomFileMissingError,
        SeriesNotViewableError,
    ):
        raise
    except (SQLAlchemyError, ManagedStorageError) as error:
        session.rollback()
        raise PersistenceError() from error
