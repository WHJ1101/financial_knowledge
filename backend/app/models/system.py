"""系统管理数据（方案 §4.4）：settings / logs / automation_tasks。"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class Setting(Base):
    """系统级配置（调度、压力快照等）。仅超管可读写（方案 §4.4，修正 v3）。"""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)


class Log(Base):
    """系统运行日志（超管专属）。写入前对 BYOK key 脱敏（方案 §9.6）。"""

    __tablename__ = "logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    log_metadata: Mapped[dict[str, Any]] = mapped_column("meta", JSONB, default=dict)
    created_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    local_time: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AutomationTask(Base):
    """自动化任务（系统级，scope=system）。执行身份用超管 BYOK（方案 §4.4）。"""

    __tablename__ = "automation_tasks"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(128))
    scope: Mapped[str] = mapped_column(String(16), default="system")  # 一期仅 system
    execution_owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    implementation: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    schedule: Mapped[str | None] = mapped_column(String(64), nullable=True)  # tick_scheduler 读取（§7.6）
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AutomationRun(TimestampMixin, Base):
    """一次可审计的自动化编排运行。"""

    __tablename__ = "automation_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')",
            name="ck_automation_runs_status",
        ),
        CheckConstraint(
            "trigger IN ('manual', 'schedule', 'retry')",
            name="ck_automation_runs_trigger",
        ),
        Index(
            "uq_automation_runs_active_kind",
            "kind",
            unique=True,
            postgresql_where="status IN ('queued', 'running')",
        ),
        Index("ix_automation_runs_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("automation_tasks.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    trigger: Mapped[str] = mapped_column(String(16))
    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="queued")
    queue_job_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    current_step: Mapped[str | None] = mapped_column(String(32), nullable=True)
    step_summary: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SourceSyncRun(TimestampMixin, Base):
    """一次来源能力同步；可独立运行，也可作为自动化运行的子运行。"""

    __tablename__ = "source_sync_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')",
            name="ck_source_sync_runs_status",
        ),
        CheckConstraint(
            "trigger IN ('manual', 'schedule', 'backfill', 'retry')",
            name="ck_source_sync_runs_trigger",
        ),
        Index(
            "uq_source_sync_runs_active_key",
            "idempotency_key",
            unique=True,
            postgresql_where="status IN ('queued', 'running')",
        ),
        Index("ix_source_sync_runs_source_created", "source_key", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    automation_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("automation_runs.id", ondelete="SET NULL"), nullable=True
    )
    source_key: Mapped[str] = mapped_column(String(64))
    capability_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    trigger: Mapped[str] = mapped_column(String(16))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    range_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    range_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    scanned_count: Mapped[int] = mapped_column(Integer, default=0)
    changed_count: Mapped[int] = mapped_column(Integer, default=0)
    written_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    queue_job_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
