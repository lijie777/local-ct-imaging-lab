from __future__ import annotations

from datetime import datetime, timezone


def utc_now_for_storage() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
