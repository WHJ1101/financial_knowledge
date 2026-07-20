"""SQLAlchemy 声明式基类与公共 Mixin（方案 §4）。

- 全新 schema：时间统一 timestamptz、JSON 用 JSONB、金额用 Numeric（方案 §4.1）。
- UUID 主键默认用 uuid4；辩论 id 用 ULID（方案 ADR-020）。
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


class TimestampMixin:
    """创建/更新时间，统一 timestamptz（方案 §4.1）。"""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    """UUID 主键列工厂。"""
    return mapped_column(primary_key=True, default=uuid.uuid4)
