"""公共/系统数据模型（方案 §4.4）。

公共共享：community_signals / market_indices / daily_bars / quote_overrides。
系统管理（超管专属）：settings / logs / automation_tasks。
只读归档：decisions。
个人态：user_signal_states。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CommunitySignal(Base, TimestampMixin):
    """社群/情绪信号（公共共享）。id 沿用旧 TEXT 主键。"""

    __tablename__ = "community_signals"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    date: Mapped[str] = mapped_column(String(16), index=True)
    source: Mapped[str] = mapped_column(String(64))
    source_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    theme: Mapped[str | None] = mapped_column(String(128), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(64), nullable=True)
    related_assets: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    signal_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[str] = mapped_column(String(16), default="medium")
    verification_status: Mapped[str] = mapped_column(String(16), default="待验证")
    importance: Mapped[int] = mapped_column(Integer, default=3)
    observed_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    imported_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    expires_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    signal_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)


class UserSignalState(Base):
    """信号个人态（信号本体公共，确认/忽略按人隔离，方案 §4.3）。"""

    __tablename__ = "user_signal_states"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    signal_id: Mapped[str] = mapped_column(ForeignKey("community_signals.id", ondelete="CASCADE"), primary_key=True)
    state: Mapped[str] = mapped_column(String(16), default="unread")  # unread | confirmed | ignored
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


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
