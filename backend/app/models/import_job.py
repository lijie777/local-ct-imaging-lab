from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import utc_now_for_storage


if TYPE_CHECKING:
    from app.models.patient import Patient


class ImportJob(Base):
    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint(
            "(status IN ('uploading', 'queued', 'running') AND "
            "active_slot IS NOT NULL AND active_slot = 1) OR "
            "(status IN ('completed', 'failed') AND active_slot IS NULL)",
            name="status_active_slot",
        ),
        CheckConstraint(
            "total_files BETWEEN 1 AND 2000",
            name="total_files",
        ),
        CheckConstraint(
            "total_bytes BETWEEN 1 AND 8589934592",
            name="total_bytes",
        ),
        CheckConstraint(
            "uploaded_bytes >= 0 AND uploaded_bytes <= total_bytes",
            name="uploaded_bytes",
        ),
        CheckConstraint(
            "created_at <= updated_at",
            name="timestamp_order",
        ),
        CheckConstraint(
            "started_at IS NULL OR (created_at <= started_at AND "
            "started_at <= updated_at)",
            name="started_at_order",
        ),
        CheckConstraint(
            "completed_at IS NULL OR (created_at <= completed_at AND "
            "completed_at <= updated_at AND "
            "(started_at IS NULL OR started_at <= completed_at))",
            name="completed_at_order",
        ),
        CheckConstraint(
            "(status IN ('uploading', 'queued', 'running') AND "
            "completed_at IS NULL) OR "
            "(status IN ('completed', 'failed') AND completed_at IS NOT NULL)",
            name="completed_at_status",
        ),
        UniqueConstraint(
            "patient_id",
            "active_slot",
            name="uq_import_jobs_patient_active",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="uploading",
    )
    active_slot: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    total_files: Mapped[int] = mapped_column(Integer, nullable=False)
    total_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    uploaded_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
    )
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
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
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False),
        nullable=True,
    )

    patient: Mapped[Patient] = relationship(back_populates="import_jobs")
    files: Mapped[list[ImportJobFile]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ImportJobFile(Base):
    __tablename__ = "import_job_files"
    __table_args__ = (
        CheckConstraint(
            "ordinal BETWEEN 0 AND 1999",
            name="ordinal",
        ),
        CheckConstraint(
            "size_bytes BETWEEN 1 AND 536870912",
            name="size_bytes",
        ),
        CheckConstraint(
            "last_modified_ms >= 0",
            name="last_modified_ms",
        ),
        CheckConstraint(
            "confirmed_offset >= 0 AND confirmed_offset <= size_bytes",
            name="confirmed_offset",
        ),
        UniqueConstraint(
            "job_id",
            "ordinal",
            name="uq_import_job_files_job_ordinal",
        ),
        UniqueConstraint(
            "job_id",
            "relative_path",
            name="uq_import_job_files_job_relative_path",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_modified_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    resume_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    confirmed_offset: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
    )

    job: Mapped[ImportJob] = relationship(back_populates="files")
