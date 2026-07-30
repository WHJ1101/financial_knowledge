"""自动化任务执行器（移植 daily-job.js/task-kinds.js 的任务分派，方案 §11.6）。

scheduler_service.tick 判定到点后创建运行台账并 defer 到 worker。
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
from app.models import AutomationRun, AutomationTask, Instrument, Position, Setting, User
from app.repositories.scoping import scope_condition
from app.services.logs import append_log
from app.services.run_lifecycle import finish_run, finish_step, mark_run_running, start_step


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


def _start_step(session: Any, run_id: str | None, key: str) -> None:
    if run_id is None:
        return
    start_step(session, run_id, key)
    session.commit()


def _finish_step(
    session: Any,
    run_id: str | None,
    key: str,
    status: str,
    *,
    count: int | None = None,
    error_code: str | None = None,
    error_message: object | None = None,
) -> None:
    if run_id is None:
        return
    finish_step(
        session,
        run_id,
        key,
        status=status,
        count=count,
        error_code=error_code,
        error_message=error_message,
    )
    session.commit()


async def run_daily_job(
    session: Any,
    admin: User,
    source: str,
    task_id: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    """完整日更：信号同步、简报、压力、组合日线、通知和状态落库。"""
    from app.services.daily_briefing import run_daily_briefing
    from app.services.portfolio_history import sync_portfolio_bars
    from app.services.pressure_monitor import get_pressure_snapshot, run_pressure_monitor
    from app.services.report_lifecycle import create_daily_briefing_report
    from app.services.signal_ingestion import create_daily_signal_run, top_community_signals
    from app.services.signal_ingestion.config import is_feishu_signal_configured

    now = datetime.now(UTC)
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    last_daily = session.get(Setting, "lastDailyRun")
    if source == "scheduled" and last_daily is not None and last_daily.value == today:
        append_log(session, "daily_job", "Daily job skipped: already completed today", {"taskId": task_id})
        _start_step(session, run_id, "daily_guard")
        _finish_step(session, run_id, "daily_guard", "skipped")
        if run_id is not None:
            finish_run(session, run_id, status="succeeded")
        session.commit()
        return {"skipped": True, "reason": "已执行过今日日更", "report": None}

    partial = False
    pressure: dict[str, Any]
    _start_step(session, run_id, "feishu")
    if not is_feishu_signal_configured():
        signal_sync: dict[str, Any] = {
            "ok": False,
            "skipped": True,
            "reason": "未配置飞书社群信号源",
            "written": 0,
        }
    elif run_id is None:
        signal_sync = {
            "ok": False,
            "skipped": True,
            "reason": "独立日更没有自动化运行 ID，未创建来源子运行",
            "written": 0,
        }
    else:
        try:
            signal_sync = await create_daily_signal_run(
                session,
                automation_run_id=uuid.UUID(run_id),
                execution_owner_id=admin.id,
                trigger="schedule" if source == "scheduled" else "manual",
            )
        except Exception as exc:  # noqa: BLE001 -- 附属来源失败形成 partial
            session.rollback()
            signal_sync = {
                "ok": False,
                "skipped": False,
                "status": "failed",
                "reason": f"{type(exc).__name__}: {str(exc)[:160]}",
                "written": 0,
            }
            append_log(session, "community_signal_sync", "Daily signal sync failed", signal_sync)
            session.commit()
    if signal_sync.get("skipped"):
        _finish_step(session, run_id, "feishu", "skipped")
    elif signal_sync.get("status") == "succeeded":
        written = int(signal_sync.get("written") or 0)
        _finish_step(session, run_id, "feishu", "succeeded", count=written)
    else:
        partial = True
        reason = signal_sync.get("reason") or signal_sync.get("error_code") or "飞书信号同步失败"
        _finish_step(
            session,
            run_id,
            "feishu",
            "failed",
            error_code="source_sync_failed",
            error_message=reason,
        )

    settings = get_settings()
    _start_step(session, run_id, "market")
    positions = [
        {"code": c, "name": n, "market": m, "shares": float(s), "cost": float(co)}
        for (c, n, m, s, co) in session.execute(
            select(Instrument.display_code, Instrument.name, Instrument.market, Position.shares, Position.cost)
            .join(Instrument, Position.instrument_id == Instrument.id)
            .where(scope_condition(Position, admin.id))
            .order_by(Position.updated_at.desc())
            .limit(50)
        ).all()
    ]
    signals = top_community_signals(session, limit=8)
    from app.services.research_data_hub.repository import macro_evidence_bundle

    _start_step(session, run_id, "research_data")
    macro_bundle = macro_evidence_bundle(session, as_of=now).as_dict()
    macro_fact_count = len(macro_bundle["facts"])
    _finish_step(
        session,
        run_id,
        "research_data",
        "succeeded" if macro_fact_count else "skipped",
        count=macro_fact_count,
    )
    brief = await run_daily_briefing(
        now,
        positions,
        signals=signals,
        eastmoney_enabled=not settings.daily_briefing_eastmoney_disabled,
    )
    brief["macroContext"] = macro_bundle
    brief.setdefault("evidence", []).append(
        {
            "title": "Research Data Hub 宏观快照",
            "source": "Research Data Hub",
            "observedAt": now.isoformat(),
            "confidence": "medium" if macro_fact_count else "low",
            "excerpt": str(macro_bundle["facts"][:12]),
        }
    )
    brief.setdefault("dataQuality", []).append(
        {
            "name": "Research Data Hub",
            "status": (
                f"正常 · {macro_fact_count} 项宏观事实"
                if macro_fact_count
                else f"待刷新 · {len(macro_bundle['data_gaps'])} 项缺口"
            ),
        }
    )
    _finish_step(
        session,
        run_id,
        "market",
        "succeeded",
        count=len(brief.get("dataQuality") or []),
    )
    _start_step(session, run_id, "report")
    report = create_daily_briefing_report(session, admin, brief, now, source=source)
    _finish_step(session, run_id, "report", "succeeded", count=1)

    portfolio_history: list[dict[str, Any]] | dict[str, str]
    _start_step(session, run_id, "pressure")
    try:
        pressure = await run_pressure_monitor(session, source=source)
        _finish_step(session, run_id, "pressure", "succeeded", count=len(pressure.get("themes") or []))
    except Exception as exc:  # noqa: BLE001 -- 报告已落库，压力故障独立降级
        session.rollback()
        partial = True
        pressure = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        append_log(
            session, "pressure_monitor", "Pressure monitor failed during daily job", {"source": source, **pressure}
        )
        session.commit()
        _finish_step(
            session,
            run_id,
            "pressure",
            "failed",
            error_code="pressure_sync_failed",
            error_message=pressure["error"],
        )

    _start_step(session, run_id, "portfolio_history")
    try:
        portfolio_history = await sync_portfolio_bars(session, admin.id)
        _finish_step(
            session,
            run_id,
            "portfolio_history",
            "succeeded",
            count=len(portfolio_history),
        )
    except Exception as exc:  # noqa: BLE001 -- 组合回补故障独立降级
        session.rollback()
        partial = True
        portfolio_history = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        append_log(
            session,
            "portfolio_history",
            "Portfolio history sync failed during daily job",
            {"source": source, **portfolio_history},
        )
        session.commit()
        _finish_step(
            session,
            run_id,
            "portfolio_history",
            "failed",
            error_code="portfolio_history_failed",
            error_message=portfolio_history["error"],
        )

    _start_step(session, run_id, "notification")
    from app.services.notification_delivery import deliver_daily_briefing

    notify_result = await deliver_daily_briefing(
        session,
        get_pressure_snapshot(session),
        requested_by=admin.id,
    )
    if notify_result.get("skipped"):
        _finish_step(session, run_id, "notification", "skipped")
    elif notify_result.get("ok"):
        _finish_step(
            session,
            run_id,
            "notification",
            "succeeded",
            count=int(notify_result.get("count") or 0),
        )
    else:
        partial = True
        _finish_step(
            session,
            run_id,
            "notification",
            "failed",
            error_code="notification_failed",
            error_message=notify_result.get("error"),
        )
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
            "runId": run_id,
            "signalSync": signal_sync,
            "pressureFailed": bool(pressure.get("error")),
            "portfolioHistoryFailed": isinstance(portfolio_history, dict),
            "notification": notify_result,
        },
    )
    if run_id is not None:
        finish_run(session, run_id, status="partial" if partial else "succeeded")
    session.commit()
    return {
        "skipped": False,
        "report": report,
        "signalSync": signal_sync,
        "pressure": pressure,
        "portfolioHistory": portfolio_history,
        "notification": notify_result,
    }


def run_daily_automation(run_id: str) -> None:
    """Worker 入口：锁定运行、解析执行身份并驱动完整异步日更。"""
    import asyncio

    with SessionLocal() as session:
        run = session.get(AutomationRun, uuid.UUID(run_id))
        if run is None or run.status in {"succeeded", "partial", "failed", "canceled"}:
            return
        mark_run_running(session, run.id)
        session.commit()
        admin = session.get(User, run.requested_by) if run.requested_by else None
        if admin is None and run.task_id:
            task = session.get(AutomationTask, run.task_id)
            admin = session.get(User, task.execution_owner_id) if task and task.execution_owner_id else None
        if admin is None or admin.role != "superadmin" or admin.status != "active":
            admin = session.execute(
                select(User)
                .where(User.role == "superadmin", User.status == "active")
                .order_by(User.created_at)
                .limit(1)
            ).scalar_one_or_none()
        if admin is None:
            finish_run(
                session,
                run.id,
                status="failed",
                error_code="execution_owner_unavailable",
                error_message="没有可用的超级管理员执行身份",
            )
            append_log(session, "automation_task", "Daily briefing failed: no superadmin", {"runId": run_id})
            session.commit()
            return
        try:
            asyncio.run(
                run_daily_job(
                    session,
                    admin,
                    "scheduled" if run.trigger == "schedule" else "daily",
                    str(run.task_id) if run.task_id else None,
                    run_id,
                )
            )
        except Exception as exc:  # noqa: BLE001 -- Worker 必须把业务终态写回台账
            session.rollback()
            current = session.get(AutomationRun, run.id)
            if current and current.status == "running" and current.current_step:
                finish_step(
                    session,
                    current.id,
                    current.current_step,
                    status="failed",
                    error_code="step_failed",
                    error_message=exc,
                )
            finish_run(
                session,
                run.id,
                status="failed",
                error_code="daily_run_failed",
                error_message=exc,
            )
            append_log(
                session,
                "automation_task",
                "Daily briefing run failed",
                {"runId": run_id, "error": f"{type(exc).__name__}: {str(exc)[:160]}"},
            )
            session.commit()


def run_automation_task(run_id: str) -> None:
    """按台账分派通用自动化任务；无执行器时写入明确失败终态。"""
    with SessionLocal() as session:
        run = session.get(AutomationRun, uuid.UUID(run_id))
        if run is None or run.status in {"succeeded", "partial", "failed", "canceled"}:
            return
        task = session.get(AutomationTask, run.task_id) if run.task_id else None
        if task is None:
            mark_run_running(session, run.id)
            finish_run(
                session,
                run.id,
                status="failed",
                error_code="task_not_found",
                error_message="自动化任务不存在",
            )
            session.commit()
            return
        if is_daily_briefing_task(task):
            session.close()
            run_daily_automation(run_id)
            return
        mark_run_running(session, run.id)
        finish_run(
            session,
            run.id,
            status="failed",
            error_code="executor_unconfigured",
            error_message=f"任务 {task.name or task.id} 尚未配置执行器",
        )
        append_log(
            session,
            "automation_task",
            f"No executor configured for task: {task.name or task.id}",
            {"id": str(task.id), "runId": run_id},
        )
        session.commit()
