"""状态概览 API（方案 §11.9）。移植 routes/reports.js:getStatus。

登录成员：报告统计（按可见性过滤）+ 市场快照就绪 + BYOK 配置态 + 自动化设置。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db import get_session
from app.models import AutomationRun, LlmProfile, Report, Setting, SourceSyncRun, User, UserReportState
from app.repositories.scoping import scoped_select
from app.services.market import get_market_snapshot
from app.services.run_lifecycle import automation_run_view, source_sync_run_view

router = APIRouter(prefix="/api/v1", tags=["status"])

_TZ = ZoneInfo("Asia/Shanghai")
_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


@router.get("/status")
def status(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, Any]:
    now = datetime.now(UTC)
    local = now.astimezone(_TZ)
    today = local.strftime("%Y-%m-%d")
    now_display = f"{_WEEKDAYS[local.weekday()]} · {local.strftime('%Y-%m-%d %H:%M:%S')}"

    # 可见报告（shared 或自有）+ 本人已读态
    reports = (
        session.execute(scoped_select(Report, user.id, access="visible"))
        .scalars()
        .all()
    )
    read_ids = {
        s.report_id
        for s in session.execute(
            scoped_select(UserReportState, user.id).where(UserReportState.read_at.isnot(None))
        )
        .scalars()
        .all()
    }
    seven_days_ago = local.date().toordinal() - 6
    today_updates = sum(1 for r in reports if r.local_date == today)
    unread = sum(1 for r in reports if r.id not in read_ids)
    recent = sum(1 for r in reports if r.local_date and _ordinal(r.local_date) >= seven_days_ago)
    automation = sum(1 for r in reports if r.origin == "automation")
    manual = sum(1 for r in reports if r.origin == "manual")

    llm_configured = (
        session.execute(
            scoped_select(LlmProfile, user.id).where(
                LlmProfile.enabled.is_(True),
                LlmProfile.is_default.is_(True),
            )
        ).first()
        is not None
    )
    auto_flag = session.get(Setting, "automationEnabled")
    daily_sched = session.get(Setting, "dailyScheduleTime")

    payload: dict[str, Any] = {
        "app": "financial_knowledge",
        "now": now_display,
        "today": today,
        "nowIso": now.isoformat(),
        "nowDisplay": now_display,
        "todayUpdates": today_updates,
        "unreadCount": unread,
        "recentCount": recent,
        "reportCount": len(reports),
        "originCounts": {"automation": automation, "manual": manual},
        "llm": {"configured": llm_configured},
        "market": {"ready": get_market_snapshot()["updatedAt"] is not None},
        "settings": {
            "automationEnabled": bool(auto_flag.value) if auto_flag else False,
            "dailyScheduleTime": daily_sched.value if daily_sched else None,
            "llmConfigured": llm_configured,
        },
    }
    if user.role == "superadmin":
        latest_run = session.execute(
            select(AutomationRun).order_by(AutomationRun.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        recent_sources = session.execute(
            select(SourceSyncRun).order_by(SourceSyncRun.created_at.desc()).limit(100)
        ).scalars()
        source_health: list[dict[str, Any]] = []
        seen_sources: set[str] = set()
        for run in recent_sources:
            if run.source_key in seen_sources:
                continue
            seen_sources.add(run.source_key)
            health = {
                "succeeded": "ready",
                "partial": "degraded",
                "failed": "unavailable",
                "canceled": "unavailable",
            }.get(run.status, run.status)
            source_health.append(
                {
                    "source_key": run.source_key,
                    "health": health,
                    "latest_run": source_sync_run_view(run),
                }
            )
        payload["operations"] = {
            "latest_run": automation_run_view(latest_run) if latest_run else None,
            "sources": source_health,
        }
    return payload


def _ordinal(local_date: str) -> int:
    try:
        y, m, d = (int(x) for x in local_date.split("-"))
        return datetime(y, m, d).toordinal()
    except (ValueError, TypeError):
        return 0
