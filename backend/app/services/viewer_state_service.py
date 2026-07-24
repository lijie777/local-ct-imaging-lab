from __future__ import annotations

import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    PersistenceError,
    SeriesNotFoundError,
    ViewerStateInvalidError,
)
from app.models.common import utc_now_for_storage
from app.models.series import Series
from app.models.viewer_state import ViewerState
from app.schemas.viewer_state import ViewerStateRead, ViewerStateWrite


MAX_VIEWER_STATE_BYTES = 2 * 1024 * 1024


def _series_or_error(session: Session, series_id: UUID) -> Series:
    series = session.get(Series, series_id)
    if series is None:
        raise SeriesNotFoundError()
    return series


def _canonical_payload(payload: ViewerStateWrite) -> dict[str, object]:
    try:
        serialized = json.dumps(
            payload.state.model_dump(mode="json"),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as error:
        raise ViewerStateInvalidError() from error
    if len(serialized.encode("utf-8")) > MAX_VIEWER_STATE_BYTES:
        raise ViewerStateInvalidError()
    return json.loads(serialized)


def get_viewer_state(session: Session, series_id: UUID) -> ViewerStateRead | None:
    try:
        _series_or_error(session, series_id)
        state = session.get(ViewerState, series_id)
        if state is None:
            return None
        return ViewerStateRead.from_viewer_state(state)
    except (SeriesNotFoundError, ViewerStateInvalidError):
        raise
    except ValidationError as error:
        raise ViewerStateInvalidError() from error
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def put_viewer_state(
    session: Session,
    series_id: UUID,
    payload: ViewerStateWrite,
) -> ViewerStateRead:
    canonical_payload = _canonical_payload(payload)
    try:
        _series_or_error(session, series_id)
        state = session.get(ViewerState, series_id)
        now = utc_now_for_storage()
        if state is None:
            state = ViewerState(
                series_id=series_id,
                schema_version=payload.schema_version,
                payload=canonical_payload,
                created_at=now,
                updated_at=now,
            )
            session.add(state)
        else:
            state.schema_version = payload.schema_version
            state.payload = canonical_payload
            state.updated_at = now
        session.flush()
        session.refresh(state)
        response = ViewerStateRead.from_viewer_state(state)
        session.commit()
        return response
    except (SeriesNotFoundError, ViewerStateInvalidError):
        raise
    except ValidationError as error:
        session.rollback()
        raise ViewerStateInvalidError() from error
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error


def delete_viewer_state(session: Session, series_id: UUID) -> None:
    try:
        _series_or_error(session, series_id)
        state = session.get(ViewerState, series_id)
        if state is not None:
            session.delete(state)
        session.commit()
    except SeriesNotFoundError:
        raise
    except SQLAlchemyError as error:
        session.rollback()
        raise PersistenceError() from error
