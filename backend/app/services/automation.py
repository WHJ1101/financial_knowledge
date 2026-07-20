"""自动化任务执行器（移植 daily-job.js/task-kinds.js 的任务分派，方案 §11.6）。

scheduler_service.tick 判定到点后 defer 到 worker，最终调 run_daily_briefing_task。
日更简报以超管身份执行（owner=超管、自动化产出）；异步抓取行情/快讯。
非日更任务暂无执行器（记日志跳过，对齐旧 runAutomationTask）。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import AutomationTask, Instrument, Position, Setting, User
from app.services.logs import append_log


def is_daily_briefing_task(task: AutomationTask) -> bool:
    """判定是否日更简报任务（移植 isDailyBriefingTask）。"""
    text = f"{task.name or ''} {task.implementation or ''}"
    return task.name == "daily-research" or bool(re.search(r"每日市场简报|日更", text))


def _set_setting(session: Any, key: str, value: Any) -> None:
    row = session.get(Setting, key)
    if row is None:
        session.add(Setting(key=key, value=value))
    else:
        row.value = value


async def run_daily_job(session: Any, admin: User, source: str, task_id: str | None = None) -> dict[str, Any]:
    """完整日更：信号同步、简报、压力、组合日线、通知和状态落库。"""
    from app.providers import feishu
    from app.services.daily_briefing import run_daily_briefing
    from app.services.portfolio_history import sync_portfolio_bars
    from app.services.pressure_monitor import get_pressure_snapshot, run_pressure_monitor
    from app.services.report_lifecycle import create_daily_briefing_report
    from app.services.signal_sync import sync_feishu_signals_async, top_community_signals

    now = datetime.now(UTC)
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    last_daily = session.get(Setting, "lastDailyRun")
    if source == "scheduled" and last_daily is not None and last_daily.value == today:
        append_log(session, "daily_job", "Daily job skipped: already completed today", {"taskId": task_id})
        session.commit()
        return {"skipped": True, "reason": "已执行过今日日更", "report": None}

    pressure: dict[str, Any]
    try:
        signal_sync = await sync_feishu_signals_async(session, str(admin.id))
    except Exception as exc:  # noqa: BLE001 -- 单个附属步骤不阻断简报
        session.rollback()
        signal_sync = {"ok": False, "skipped": False, "reason": f"{type(exc).__name__}: {str(exc)[:160]}"}
        append_log(session, "community_signal_sync", "Daily signal sync failed", signal_sync)
        session.commit()

    settings = get_settings()
    positions = [
        {"code": c, "name": n, "market": m, "shares": float(s), "cost": float(co)}
        for (c, n, m, s, co) in session.execute(
            select(Instrument.display_code, Instrument.name, Instrument.market, Position.shares, Position.cost)
            .join(Instrument, Position.instrument_id == Instrument.id)
            .where(Position.owner_id == admin.id)
            .order_by(Position.updated_at.desc())
            .limit(50)
        ).all()
    ]
    signals = top_community_signals(session, limit=8)
    brief = await run_daily_briefing(
        now,
        positions,
        signals=signals,
        eastmoney_enabled=not settings.daily_briefing_eastmoney_disabled,
    )
    report = create_daily_briefing_report(session, admin, brief, now, source=source)

    portfolio_history: list[dict[str, Any]] | dict[str, str]
    try:
        pressure = await run_pressure_monitor(session, source=source)
    except Exception as exc:  # noqa: BLE001 -- 报告已落库，压力故障独立降级
        session.rollback()
        pressure = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        append_log(
            session, "pressure_monitor", "Pressure monitor failed during daily job", {"source": source, **pressure}
        )
        session.commit()

    try:
        portfolio_history = await sync_portfolio_bars(session, admin.id)
    except Exception as exc:  # noqa: BLE001 -- 组合回补故障独立降级
        session.rollback()
        portfolio_history = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        append_log(
            session,
            "portfolio_history",
            "Portfolio history sync failed during daily job",
            {"source": source, **portfolio_history},
        )
        session.commit()

    notify_result = await feishu.notify_daily_briefing(get_pressure_snapshot(session))
    window = brief.get("window")
    window_end = getattr(window, "end", None)
    _set_setting(session, "lastDailyRun", today)
    _set_setting(session, "lastDailyBriefingRunAt", datetime.now(UTC).isoformat())
    _set_setting(
        session,
        "lastDailyBriefingWindowEnd",
        window_end.isoformat() if isinstance(window_end, datetime) else None,
    )
    _set_setting(session, "lastDailyBriefingSourceStats", brief.get("dataQuality") or [])
    _set_setting(session, "lastCommunitySignalSync", signal_sync)
    append_log(
        session,
        "daily_job",
        f"Daily job created report: {report.title}",
        {
            "source": source,
            "taskId": task_id,
            "signalSync": signal_sync,
            "pressureFailed": bool(pressure.get("error")),
            "portfolioHistoryFailed": isinstance(portfolio_history, dict),
            "notification": notify_result,
        },
    )
    session.commit()
    return {
        "skipped": False,
        "report": report,
        "signalSync": signal_sync,
        "pressure": pressure,
        "portfolioHistory": portfolio_history,
        "notification": notify_result,
    }


def run_daily_briefing_task(task_id: str) -> None:
    """worker 同步入口，内部驱动完整异步日更。"""
    import asyncio

    with SessionLocal() as session:
        admin = session.execute(
            select(User).where(User.role == "superadmin", User.status == "active").order_by(User.created_at).limit(1)
        ).scalar_one_or_none()
        if admin is None:
            append_log(session, "automation_task", "Daily briefing skipped: no superadmin", {"taskId": task_id})
            session.commit()
            return
        asyncio.run(run_daily_job(session, admin, "scheduled", task_id))


def run_automation_task(task_id: str) -> None:
    """任务分派（移植 runAutomationTask）：日更走 run_daily_briefing_task，其余记日志跳过。"""
    with SessionLocal() as session:
        task = session.get(AutomationTask, uuid.UUID(task_id))
        if task is None:
            return
        if is_daily_briefing_task(task):
            run_daily_briefing_task(task_id)
            return
        append_log(
            session, "automation_task", f"No executor configured for task: {task.name or task.id}", {"id": str(task.id)}
        )
        session.commit()
