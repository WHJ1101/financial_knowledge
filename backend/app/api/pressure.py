"""压力监控 API（方案 §3.4）。公共只读，任何登录用户可读。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db import get_session
from app.models import User
from app.services.pressure_monitor import get_pressure_snapshot

router = APIRouter(prefix="/api/v1", tags=["pressure"])


@router.get("/pressure")
def pressure(
    _: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, list[dict[str, Any]]]:
    return {"themes": get_pressure_snapshot(session)}
