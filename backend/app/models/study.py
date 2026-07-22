from __future__ import annotations

from datetime import date, datetime, time
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Time, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import utc_now_for_storage


if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.series import Series


class Study(Base):
    __tablename__ = "studies"
    __table_args__ = (
        Index("uq_studies_study_instance_uid", "study_instance_uid", unique=True),
        Index(
            "ix_studies_patient_sort",
            "patient_id",
            "study_date",
            "created_at",
            "study_instance_uid",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    study_instance_uid: Mapped[str] = mapped_column(String(64), nullable=False)
    dicom_patient_id: Mapped[str] = mapped_column(String(64), nullable=False)
    study_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    study_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    accession_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now_for_storage
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=utc_now_for_storage
    )

    patient: Mapped[Patient] = relationship(back_populates="studies")
    series_items: Mapped[list[Series]] = relationship(
        back_populates="study",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
