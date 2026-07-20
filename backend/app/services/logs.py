"""系统日志写入（移植 server/services/logs.js，方案 §9.6）。

写入前对 BYOK key 等敏感串脱敏由调用方保证（本函数只落库）。
id 沿用旧「毫秒时间戳-随机」格式；local_time 用 Asia/Shanghai。
"""

from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import Log

_TZ = ZoneInfo("Asia/Shanghai")


def _make_log_id() -> str:
    return f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"


def append_log(session: Session, log_type: str, message: str, meta: dict[str, Any] | None = None) -> None:
    """追加一条系统日志（不 commit，随调用方事务提交）。"""
    now = datetime.now(UTC)
    session.add(
        Log(
            id=_make_log_id(),
            type=log_type,
            message=message,
            log_metadata=meta or {},
            created_at=now.isoformat(),
            local_time=now.astimezone(_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        )
    )
