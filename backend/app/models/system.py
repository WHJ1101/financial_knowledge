"""系统管理数据 + 只读归档（方案 §4.4）。

系统管理（超管专属）：settings / logs / automation_tasks。
只读归档：decisions（旧每日指南，冻结写入，仅超管查）。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, uuid_pk


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


class Decision(Base):
    """旧每日决策指南：只读归档，owner=超管，冻结写入（方案 §4.4，ADR-023）。"""

    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str | None] = mapped_column(Text, nullable=True)
    market: Mapped[str | None] = mapped_column(Text, nullable=True)  # 展示拼接串，实测达 137 字符
    position_advice: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    stock_advice: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    reports: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
