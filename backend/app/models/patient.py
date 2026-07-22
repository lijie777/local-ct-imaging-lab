from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    asc,
    CheckConstraint,
    Date,
    DateTime,
    desc,
    Index,
    PrimaryKeyConstraint,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import utc_now_for_storage


if TYPE_CHECKING:
    from app.models.study import Study


class Patient(Base):
    __tablename__ = "patients"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_patients"),
        CheckConstraint(
            "sex IN ('male', 'female', 'other', 'unknown')",
            name="sex",
        ),
        CheckConstraint(
            "created_at <= updated_at",
            name="timestamp_order",
        ),
        Index(
            "uq_patients_medical_record_no_normalized",
            "medical_record_no_normalized",
            unique=True,
        ),
        Index(
            "ix_patients_stable_sort",
            desc("updated_at"),
            asc("medical_record_no_normalized"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), default=uuid4)
    medical_record_no: Mapped[str] = mapped_column(String(64), nullable=False)
    medical_record_no_normalized: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sex: Mapped[str] = mapped_column(String(7), nullable=False, default="unknown")
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        default=utc_now_for_storage,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        default=utc_now_for_storage,
    )
    studies: Mapped[list[Study]] = relationship(
        back_populates="patient",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
