"""持仓与自选（方案 §4.4）：用户隔离，owner_id + 属主校验。

原 stocks 拆分：证券身份入 instruments，用户关系入 watchlist_items。
字段对齐现有 stocks.js / db.js（三轮 review 必须项 2）。
"""

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class WatchlistItem(Base, TimestampMixin):
    """自选（原 stocks 的用户关系部分）。同一用户同一标的唯一。"""

    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("owner_id", "instrument_id", name="uq_watchlist_owner_instrument"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    instrument_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("instruments.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="观察")  # 原 stocks.status
    thesis: Mapped[str | None] = mapped_column(Text, nullable=True)  # 研究假设
    advice: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk: Mapped[str | None] = mapped_column(Text, nullable=True)
    watch_signals: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    sparkline: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    analysis_status: Mapped[str] = mapped_column(String(16), default="pending")


class Position(Base, TimestampMixin):
    """持仓。现有允许同标的多笔，迁移保持"一标的一行"，合并策略作为显式业务决策。"""

    __tablename__ = "positions"

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    instrument_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("instruments.id"), index=True)
    shares: Mapped[float] = mapped_column(Numeric(20, 4), default=0)
    cost: Mapped[float] = mapped_column(Numeric(20, 4), default=0)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk: Mapped[str | None] = mapped_column(Text, nullable=True)
    analysis_status: Mapped[str] = mapped_column(String(16), default="pending")
