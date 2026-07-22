from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import utc_now_for_storage


if TYPE_CHECKING:
    from app.models.series import Series


class Instance(Base):
    __tablename__ = "instances"
    __table_args__ = (
        Index("uq_instances_sop_instance_uid", "sop_instance_uid", unique=True),
        Index(
            "ix_instances_series_sort",
            "series_id",
            "instance_number",
            "sop_instance_uid",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    series_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("series.id", ondelete="CASCADE"),
        nullable=False,
    )
    sop_instance_uid: Mapped[str] = mapped_column(String(64), nullable=False)
    sop_class_uid: Mapped[str] = mapped_column(String(64), nullable=False)
    transfer_syntax_uid: Mapped[str] = mapped_column(String(64), nullable=False)
    instance_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_position_patient: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_orientation_patient: Mapped[str | None] = mapped_column(Text, nullable=True)
    rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    columns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    managed_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now_for_storage
    )

    series: Mapped[Series] = relationship(back_populates="instances")
