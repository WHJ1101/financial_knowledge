"""宏观数据（方案 §4.6/§6）：series 定义 + observations 观测值。

时点口径铁律：观测带 release_at，决策只取 release_at<=as_of（§6.1）。
唯一键 (source, code)（三轮 review 必须项 6）；revision_hash NOT NULL 以支持去重。
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class MacroSeries(Base, TimestampMixin):
    __tablename__ = "macro_series"
    __table_args__ = (UniqueConstraint("source", "code", name="uq_macro_series_source_code"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    source: Mapped[str] = mapped_column(String(32))  # eastmoney/nbs/jin10…（同 code 可能多源）
    code: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128))
    region: Mapped[str] = mapped_column(String(32))
    category: Mapped[str] = mapped_column(String(32))
    frequency: Mapped[str] = mapped_column(String(16))  # monthly/quarterly/…
    unit: Mapped[str] = mapped_column(String(32))
    value_type: Mapped[str] = mapped_column(String(16))  # yoy | mom | absolute
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class MacroObservation(Base):
    __tablename__ = "macro_observations"
    __table_args__ = (
        UniqueConstraint("series_id", "observation_period", "revision_hash", name="uq_macro_obs"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("macro_series.id", ondelete="CASCADE"), index=True)
    observation_period: Mapped[str] = mapped_column(String(16))  # 如 2026-06
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 发布时间：无法确认时进 data_gap，绝不用 retrieved_at 冒充（三轮 review 必须项 6）
    release_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    value: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revision_hash: Mapped[str] = mapped_column(String(64))  # NOT NULL，支持修订去重
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
