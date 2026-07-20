"""首启初始化超管（方案 §5.2）。

幂等：超管已存在则跳过。全新部署（不迁移旧数据）由 entrypoint 调用建初始账号；
迁移场景由 import_sqlite.py 建。用 env SUPERADMIN_USERNAME/PASSWORD。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.config import get_settings
from app.core.security import hash_password
from app.db import SessionLocal
from app.models import User


def ensure_superadmin() -> str:
    """确保存在一个超管。返回状态说明。"""
    settings = get_settings()
    if not settings.superadmin_password:
        return "未配置 SUPERADMIN_PASSWORD，跳过超管初始化"
    with SessionLocal() as session:
        existing = session.execute(select(User).where(User.role == "superadmin")).scalar_one_or_none()
        if existing is not None:
            return f"超管已存在（{existing.username}），跳过"
        now = datetime.now(UTC)
        session.add(
            User(
                id=uuid.uuid4(),
                username=settings.superadmin_username,
                password_hash=hash_password(settings.superadmin_password),
                role="superadmin",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()
        return f"已创建超管：{settings.superadmin_username}"


if __name__ == "__main__":
    print(f"[bootstrap] {ensure_superadmin()}")
