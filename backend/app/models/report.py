"""报告内容 + 个人阅读态 + 报告资产关联（方案 §4.3）。

Review R1 修正：报告内容与个人态（标星/归档/已读）分离，共享后不互相污染。
报告默认 private，可发布为 shared。全字段迁移（三轮 review 必须项 2）。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class Report(Base, TimestampMixin):
    """报告内容本体。id 沿用旧 TEXT 主键（迁移保持不变）。"""

    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    visibility: Mapped[str] = mapped_column(String(16), default="private")  # private | shared
    title: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(32))
    type_label: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 保留（32/32 有值）
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    origin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    origin_label: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 保留
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    file: Mapped[str | None] = mapped_column(Text, nullable=True)  # HTML 相对路径
    local_date: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 业务自然日
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    highlights: Mapped[list[Any]] = mapped_column(JSONB, default=list)  # 32/32 非空
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # 归拢 accent(主题色) + wiki_path(源路径)
    content_status: Mapped[str] = mapped_column(String(16), default="ok")  # ok | missing（迁移缺文件）


class UserReportState(Base):
    """个人阅读态，独立于报告本体（方案 §4.3）。"""

    __tablename__ = "user_report_states"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 旧 status='read'
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReportAssetLink(Base, TimestampMixin):
    """报告↔证券关联（现有接口仍在用）。权限继承所属 report 可见性（方案 §4.3）。"""

    __tablename__ = "report_asset_links"
    __table_args__ = (
        UniqueConstraint("report_id", "instrument_id", "relation", "source", name="uq_report_asset_link"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    instrument_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("instruments.id"), index=True)
    relation: Mapped[str] = mapped_column(String(32), default="related")
    source: Mapped[str] = mapped_column(String(32), default="manual")
