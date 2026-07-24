"""Create the versioned per-Series viewer state table.

Revision ID: 003_create_viewer_states
Revises: 002_create_dicom_index
Create Date: 2026-07-23
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "003_create_viewer_states"
down_revision: str | Sequence[str] | None = "002_create_dicom_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "viewer_states",
        sa.Column("series_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.CheckConstraint("schema_version = 1", name="schema_version"),
        sa.CheckConstraint("created_at <= updated_at", name="timestamp_order"),
        sa.ForeignKeyConstraint(
            ["series_id"],
            ["series.id"],
            name="fk_viewer_states_series_id_series",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("series_id", name="pk_viewer_states"),
    )


def downgrade() -> None:
    op.drop_table("viewer_states")
