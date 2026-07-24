"""Create resumable DICOM import job tables.

Revision ID: 004_create_import_jobs
Revises: 003_create_viewer_states
Create Date: 2026-07-23
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "004_create_import_jobs"
down_revision: str | Sequence[str] | None = "003_create_viewer_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("patient_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("active_slot", sa.Integer(), nullable=True),
        sa.Column("total_files", sa.Integer(), nullable=False),
        sa.Column("total_bytes", sa.BigInteger(), nullable=False),
        sa.Column("uploaded_bytes", sa.BigInteger(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=False), nullable=True),
        sa.CheckConstraint(
            "(status IN ('uploading', 'queued', 'running') AND "
            "active_slot IS NOT NULL AND active_slot = 1) OR "
            "(status IN ('completed', 'failed') AND active_slot IS NULL)",
            name="status_active_slot",
        ),
        sa.CheckConstraint(
            "total_files BETWEEN 1 AND 2000",
            name="total_files",
        ),
        sa.CheckConstraint(
            "total_bytes BETWEEN 1 AND 8589934592",
            name="total_bytes",
        ),
        sa.CheckConstraint(
            "uploaded_bytes >= 0 AND uploaded_bytes <= total_bytes",
            name="uploaded_bytes",
        ),
        sa.CheckConstraint(
            "created_at <= updated_at",
            name="timestamp_order",
        ),
        sa.CheckConstraint(
            "started_at IS NULL OR (created_at <= started_at AND "
            "started_at <= updated_at)",
            name="started_at_order",
        ),
        sa.CheckConstraint(
            "completed_at IS NULL OR (created_at <= completed_at AND "
            "completed_at <= updated_at AND "
            "(started_at IS NULL OR started_at <= completed_at))",
            name="completed_at_order",
        ),
        sa.CheckConstraint(
            "(status IN ('uploading', 'queued', 'running') AND "
            "completed_at IS NULL) OR "
            "(status IN ('completed', 'failed') AND completed_at IS NOT NULL)",
            name="completed_at_status",
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_import_jobs_patient_id_patients",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_jobs"),
        sa.UniqueConstraint(
            "patient_id",
            "active_slot",
            name="uq_import_jobs_patient_active",
        ),
    )

    op.create_table(
        "import_job_files",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("job_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("relative_path", sa.String(length=1024), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("last_modified_ms", sa.BigInteger(), nullable=False),
        sa.Column("resume_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("confirmed_offset", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "ordinal BETWEEN 0 AND 1999",
            name="ordinal",
        ),
        sa.CheckConstraint(
            "size_bytes BETWEEN 1 AND 536870912",
            name="size_bytes",
        ),
        sa.CheckConstraint(
            "last_modified_ms >= 0",
            name="last_modified_ms",
        ),
        sa.CheckConstraint(
            "confirmed_offset >= 0 AND confirmed_offset <= size_bytes",
            name="confirmed_offset",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["import_jobs.id"],
            name="fk_import_job_files_job_id_import_jobs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_job_files"),
        sa.UniqueConstraint(
            "job_id",
            "ordinal",
            name="uq_import_job_files_job_ordinal",
        ),
        sa.UniqueConstraint(
            "job_id",
            "relative_path",
            name="uq_import_job_files_job_relative_path",
        ),
    )


def downgrade() -> None:
    op.drop_table("import_job_files")
    op.drop_table("import_jobs")
