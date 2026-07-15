"""辩论任务（方案 §4.6/§7）。

id 用 ULID（ADR-020，防同标的并发碰撞）；owner_id 决定可见性、execution_owner_id 决定用谁的
BYOK key；procrastinate 同事务 defer（§4.7），无 lease_until 手写字段。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Debate(Base):
    __tablename__ = "debates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # ULID
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    execution_owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))  # BYOK 执行身份
    instrument_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("instruments.id"), index=True)
    graph_thread_id: Mapped[str] = mapped_column(String(128), unique=True)  # LangGraph 线程，服务端生成
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|done|failed|canceled
    progress: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 冗余便于列表
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)  # 完整报告（辩论文档 §3.4）
    error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
