"""Create Study, Series, and Instance DICOM index tables.

Revision ID: 002_create_dicom_index
Revises: 001_create_patients
Create Date: 2026-07-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "002_create_dicom_index"
down_revision: str | Sequence[str] | None = "001_create_patients"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "studies",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("patient_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("study_instance_uid", sa.String(length=64), nullable=False),
        sa.Column("dicom_patient_id", sa.String(length=64), nullable=False),
        sa.Column("study_date", sa.Date(), nullable=True),
        sa.Column("study_time", sa.Time(), nullable=True),
        sa.Column("accession_number", sa.String(length=64), nullable=True),
        sa.Column("description", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.CheckConstraint("created_at <= updated_at", name="timestamp_order"),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_studies_patient_id_patients",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_studies"),
    )
    op.create_index(
        "uq_studies_study_instance_uid",
        "studies",
        ["study_instance_uid"],
        unique=True,
    )
    op.execute(
        "CREATE INDEX ix_studies_patient_sort ON studies "
        "(patient_id, study_date DESC, created_at DESC, study_instance_uid ASC)"
    )

    op.create_table(
        "series",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("study_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("series_instance_uid", sa.String(length=64), nullable=False),
        sa.Column("modality", sa.String(length=16), nullable=False),
        sa.Column("series_number", sa.Integer(), nullable=True),
        sa.Column("description", sa.String(length=256), nullable=True),
        sa.Column("body_part_examined", sa.String(length=64), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("columns", sa.Integer(), nullable=True),
        sa.Column("viewability_status", sa.String(length=16), nullable=False),
        sa.Column("viewability_reason", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.CheckConstraint(
            "viewability_status IN ('eligible', 'unsupported')",
            name="viewability_status",
        ),
        sa.CheckConstraint(
            "(viewability_status = 'eligible' AND viewability_reason IS NULL) OR "
            "(viewability_status = 'unsupported' AND viewability_reason IS NOT NULL)",
            name="viewability_reason",
        ),
        sa.ForeignKeyConstraint(
            ["study_id"],
            ["studies.id"],
            name="fk_series_study_id_studies",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_series"),
    )
    op.create_index(
        "uq_series_series_instance_uid",
        "series",
        ["series_instance_uid"],
        unique=True,
    )
    op.execute(
        "CREATE INDEX ix_series_study_sort ON series "
        "(study_id, series_number ASC, series_instance_uid ASC)"
    )

    op.create_table(
        "instances",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("series_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sop_instance_uid", sa.String(length=64), nullable=False),
        sa.Column("sop_class_uid", sa.String(length=64), nullable=False),
        sa.Column("transfer_syntax_uid", sa.String(length=64), nullable=False),
        sa.Column("instance_number", sa.Integer(), nullable=True),
        sa.Column("image_position_patient", sa.Text(), nullable=True),
        sa.Column("image_orientation_patient", sa.Text(), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=True),
        sa.Column("columns", sa.Integer(), nullable=True),
        sa.Column("managed_path", sa.String(length=1024), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.ForeignKeyConstraint(
            ["series_id"],
            ["series.id"],
            name="fk_instances_series_id_series",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_instances"),
    )
    op.create_index(
        "uq_instances_sop_instance_uid",
        "instances",
        ["sop_instance_uid"],
        unique=True,
    )
    op.execute(
        "CREATE INDEX ix_instances_series_sort ON instances "
        "(series_id, instance_number ASC, sop_instance_uid ASC)"
    )


def downgrade() -> None:
    op.drop_index("ix_instances_series_sort", table_name="instances")
    op.drop_index("uq_instances_sop_instance_uid", table_name="instances")
    op.drop_table("instances")
    op.drop_index("ix_series_study_sort", table_name="series")
    op.drop_index("uq_series_series_instance_uid", table_name="series")
    op.drop_table("series")
    op.drop_index("ix_studies_patient_sort", table_name="studies")
    op.drop_index("uq_studies_study_instance_uid", table_name="studies")
    op.drop_table("studies")
