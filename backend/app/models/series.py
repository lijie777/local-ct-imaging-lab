from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import utc_now_for_storage


if TYPE_CHECKING:
    from app.models.instance import Instance
    from app.models.study import Study
    from app.models.viewer_state import ViewerState


class Series(Base):
    __tablename__ = "series"
    __table_args__ = (
        CheckConstraint(
            "viewability_status IN ('eligible', 'unsupported')",
            name="viewability_status",
        ),
        CheckConstraint(
            "(viewability_status = 'eligible' AND viewability_reason IS NULL) OR "
            "(viewability_status = 'unsupported' AND viewability_reason IS NOT NULL)",
            name="viewability_reason",
        ),
        Index("uq_series_series_instance_uid", "series_instance_uid", unique=True),
        Index(
            "ix_series_study_sort",
            "study_id",
            "series_number",
            "series_instance_uid",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    study_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("studies.id", ondelete="CASCADE"),
        nullable=False,
    )
    series_instance_uid: Mapped[str] = mapped_column(String(64), nullable=False)
    modality: Mapped[str] = mapped_column(String(16), nullable=False, default="CT")
    series_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(String(256), nullable=True)
    body_part_examined: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    columns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    viewability_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="eligible"
    )
    viewability_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now_for_storage
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now_for_storage
    )

    study: Mapped[Study] = relationship(back_populates="series_items")
    instances: Mapped[list[Instance]] = relationship(
        back_populates="series",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    viewer_state: Mapped[ViewerState | None] = relationship(
        back_populates="series",
        cascade="all, delete-orphan",
        single_parent=True,
        passive_deletes=True,
        uselist=False,
    )
