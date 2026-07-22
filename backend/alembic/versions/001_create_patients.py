"""Create the initial patients table.

Revision ID: 001_create_patients
Revises: None
Create Date: 2026-07-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "001_create_patients"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("medical_record_no", sa.String(length=64), nullable=False),
        sa.Column(
            "medical_record_no_normalized",
            sa.String(length=128),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "sex",
            sa.String(length=7),
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.CheckConstraint(
            "sex IN ('male', 'female', 'other', 'unknown')",
            name="sex",
        ),
        sa.CheckConstraint(
            "created_at <= updated_at",
            name="timestamp_order",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_patients"),
    )
    op.create_index(
        "uq_patients_medical_record_no_normalized",
        "patients",
        ["medical_record_no_normalized"],
        unique=True,
    )
    op.execute(
        "CREATE INDEX ix_patients_stable_sort ON patients "
        "(updated_at DESC, medical_record_no_normalized ASC)"
    )


def downgrade() -> None:
    op.drop_index("ix_patients_stable_sort", table_name="patients")
    op.drop_index(
        "uq_patients_medical_record_no_normalized",
        table_name="patients",
    )
    op.drop_table("patients")
