"""公共行情数据模型。"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MarketIndex(Base):
    """市场指数快照（公共共享）。"""

    __tablename__ = "market_indices"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    region: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(64))
    level: Mapped[str | None] = mapped_column(String(32), nullable=True)
    change_pct: Mapped[str | None] = mapped_column(String(32), nullable=True)
    volume: Mapped[str | None] = mapped_column(String(32), nullable=True)
    related_etfs: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DailyBar(Base):
    """日线（公共共享）。按 instrument 的 provider secid 存储，保留原 secid 键。"""

    __tablename__ = "daily_bars"

    secid: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[str] = mapped_column(String(16), primary_key=True)
    close: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QuoteOverride(Base):
    """手动行情覆盖（公共/系统数据，仅超管写，方案 §3.4）。"""

    __tablename__ = "quote_overrides"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    market: Mapped[str | None] = mapped_column(String(32), nullable=True)
    price: Mapped[float] = mapped_column(Float)
    change_pct: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_label: Mapped[str] = mapped_column(String(32), default="手动行情")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
