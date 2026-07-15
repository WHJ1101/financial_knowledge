"""限流：PG 固定窗口（方案 §4.5/§16）。仅 login/register/invite_verify 三个防爆破点。"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

# 各动作的窗口与上限
_LIMITS = {
    "login": (300, 10),  # 5 分钟内 10 次
    "register": (3600, 5),  # 1 小时内 5 次
    "invite_verify": (3600, 20),
}


def _key_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def check_and_incr(session: Session, action: str, identifier: str) -> bool:
    """固定窗口限流。返回 True=允许，False=超限。

    用 INSERT ... ON CONFLICT 原子自增当前窗口计数（同一 SQLAlchemy 事务内）。
    """
    window_seconds, limit = _LIMITS[action]
    now = datetime.now(UTC)
    window_start = datetime.fromtimestamp(
        (int(now.timestamp()) // window_seconds) * window_seconds, tz=UTC
    )
    expires_at = window_start + timedelta(seconds=window_seconds)
    key = _key_hash(f"{action}:{identifier}")

    row = session.execute(
        text(
            """
            INSERT INTO rate_limit_buckets (key_hash, action, window_start, count, expires_at)
            VALUES (:k, :a, :ws, 1, :exp)
            ON CONFLICT (key_hash, action, window_start)
            DO UPDATE SET count = rate_limit_buckets.count + 1
            RETURNING count
            """
        ),
        {"k": key, "a": action, "ws": window_start, "exp": expires_at},
    )
    count = row.scalar_one()
    return bool(count <= limit)
