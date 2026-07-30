"""Research Data Hub 宏观语义序列与双时间观测。"""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class MacroSeries(Base, TimestampMixin):
    __tablename__ = "macro_series"
    __table_args__ = (UniqueConstraint("semantic_key", name="uq_macro_series_semantic_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    semantic_key: Mapped[str] = mapped_column(String(192))
    code: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128))
    region: Mapped[str] = mapped_column(String(32))
    category: Mapped[str] = mapped_column(String(32))
    frequency: Mapped[str] = mapped_column(String(16))  # monthly/quarterly/…
    unit: Mapped[str] = mapped_column(String(32))
    value_type: Mapped[str] = mapped_column(String(16))  # yoy | mom | absolute
    upstream_family: Mapped[str] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class MacroObservation(Base):
    __tablename__ = "macro_observations"
    __table_args__ = (UniqueConstraint("series_id", "observation_period", "revision_hash", name="uq_macro_obs"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("macro_series.id", ondelete="CASCADE"), index=True)
    observation_period: Mapped[str] = mapped_column(String(16))  # 如 2026-06
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    available_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    value: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(64))
    upstream_family: Mapped[str] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    release_precision: Mapped[str] = mapped_column(String(16), default="unknown")
    release_confidence: Mapped[str] = mapped_column(String(16), default="unknown")
    schema_version: Mapped[str] = mapped_column(String(32))
    source_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_sync_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    payload_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("source_payload_snapshots.id", ondelete="SET NULL"), nullable=True
    )
    revision_hash: Mapped[str] = mapped_column(String(64))  # NOT NULL，支持修订去重
