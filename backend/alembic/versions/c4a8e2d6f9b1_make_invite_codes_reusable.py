"""make invite codes reusable

Revision ID: c4a8e2d6f9b1
Revises: b31f7a9c2d4e
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4a8e2d6f9b1"
down_revision: str | Sequence[str] | None = "b31f7a9c2d4e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("invite_codes_used_by_fkey", "invite_codes", type_="foreignkey")
    op.drop_column("invite_codes", "used_by")
    op.drop_column("invite_codes", "used_at")


def downgrade() -> None:
    op.add_column("invite_codes", sa.Column("used_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("invite_codes", sa.Column("used_by", sa.UUID(), nullable=True))
    op.create_foreign_key("invite_codes_used_by_fkey", "invite_codes", "users", ["used_by"], ["id"])
