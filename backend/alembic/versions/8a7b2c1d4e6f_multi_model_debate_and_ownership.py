"""multi-model debate routing and legacy ownership repair

Revision ID: 8a7b2c1d4e6f
Revises: df4995eb3fdf
Create Date: 2026-07-16
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "8a7b2c1d4e6f"
down_revision: str | Sequence[str] | None = "df4995eb3fdf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 单用户单模型配置原位升级为多 Profile，保留现有密文和模型。
    op.rename_table("user_llm_configs", "llm_profiles")
    op.add_column("llm_profiles", sa.Column("id", sa.Uuid(), nullable=True))
    op.add_column("llm_profiles", sa.Column("name", sa.String(length=64), nullable=True))
    op.add_column("llm_profiles", sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("llm_profiles", sa.Column("is_default", sa.Boolean(), server_default=sa.true(), nullable=False))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT user_id FROM llm_profiles")).all()
    for (user_id,) in rows:
        bind.execute(
            sa.text("UPDATE llm_profiles SET id=:id, name='默认模型' WHERE user_id=:user_id"),
            {"id": uuid.uuid4(), "user_id": user_id},
        )
    op.alter_column("llm_profiles", "id", nullable=False)
    op.alter_column("llm_profiles", "name", nullable=False)
    op.drop_constraint("user_llm_configs_pkey", "llm_profiles", type_="primary")
    op.create_primary_key("llm_profiles_pkey", "llm_profiles", ["id"])
    op.create_index("ix_llm_profiles_user_id", "llm_profiles", ["user_id"], unique=False)
    op.create_unique_constraint("uq_llm_profile_user_name", "llm_profiles", ["user_id", "name"])
    op.create_index(
        "uq_llm_profiles_one_default_per_user",
        "llm_profiles",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "llm_agent_routes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("temperature", sa.Float(), server_default="0.3", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["llm_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "purpose", "role", name="uq_llm_route_user_purpose_role"),
    )
    op.create_index("ix_llm_agent_routes_profile_id", "llm_agent_routes", ["profile_id"], unique=False)
    op.create_index("ix_llm_agent_routes_user_id", "llm_agent_routes", ["user_id"], unique=False)

    op.add_column("debates", sa.Column("horizon", sa.String(length=16), server_default="swing", nullable=False))
    op.add_column("debates", sa.Column("question", sa.Text(), nullable=True))
    op.add_column("debates", sa.Column("queue_job_id", sa.BigInteger(), nullable=True))
    op.add_column("debates", sa.Column("attempt", sa.Integer(), server_default="0", nullable=False))
    op.add_column(
        "debates",
        sa.Column("model_assignments", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
    )
    op.add_column("debates", sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_debates_queue_job_id", "debates", ["queue_job_id"], unique=False)
    op.create_index(
        "uq_debates_owner_instrument_active",
        "debates",
        ["owner_id", "instrument_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )

    op.add_column("decisions", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column("decisions", sa.Column("visibility", sa.String(length=16), server_default="private", nullable=False))
    op.create_foreign_key(
        "fk_decisions_owner_id_users", "decisions", "users", ["owner_id"], ["id"], ondelete="SET NULL"
    )
    bind.execute(
        sa.text(
            "UPDATE decisions SET owner_id=(SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1), "
            "visibility='private'"
        )
    )
    # 旧服务产生的报告全部属于公共存量，迁移后统一共享并归超管。
    bind.execute(
        sa.text(
            "UPDATE reports SET visibility='shared', "
            "owner_id=COALESCE((SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1), owner_id) "
            "WHERE owner_id=(SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1)"
        )
    )


def downgrade() -> None:
    op.drop_constraint("fk_decisions_owner_id_users", "decisions", type_="foreignkey")
    op.drop_column("decisions", "visibility")
    op.drop_column("decisions", "owner_id")

    op.drop_index("uq_debates_owner_instrument_active", table_name="debates")
    op.drop_index("ix_debates_queue_job_id", table_name="debates")
    for name in ("cancel_requested_at", "model_assignments", "attempt", "queue_job_id", "question", "horizon"):
        op.drop_column("debates", name)

    op.drop_index("ix_llm_agent_routes_user_id", table_name="llm_agent_routes")
    op.drop_index("ix_llm_agent_routes_profile_id", table_name="llm_agent_routes")
    op.drop_table("llm_agent_routes")

    # 只能在每用户仍恰好一个 Profile 时降级；生产迁移不应回到单模型结构。
    op.drop_index("uq_llm_profiles_one_default_per_user", table_name="llm_profiles")
    op.drop_constraint("uq_llm_profile_user_name", "llm_profiles", type_="unique")
    op.drop_index("ix_llm_profiles_user_id", table_name="llm_profiles")
    op.drop_constraint("llm_profiles_pkey", "llm_profiles", type_="primary")
    op.create_primary_key("user_llm_configs_pkey", "llm_profiles", ["user_id"])
    for name in ("is_default", "enabled", "name", "id"):
        op.drop_column("llm_profiles", name)
    op.rename_table("llm_profiles", "user_llm_configs")
