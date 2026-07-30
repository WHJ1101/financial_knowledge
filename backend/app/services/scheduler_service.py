"""动态调度 dispatcher（方案 §7.6/§11.6）。

tick 每分钟跑：读 automation_tasks enabled 任务，到点且当天未跑 → defer 业务任务。
先占位（settings 记 last_run=当天）再 defer，重叠防护（对齐 scheduler.js:26 语义）。
全局开关 automationEnabled 关闭时整体跳过（对齐旧 scheduler）。
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AutomationTask, Setting
from app.services.automation import is_daily_briefing_task
from app.services.run_lifecycle import create_automation_run

_TZ = ZoneInfo("Asia/Shanghai")


def _parse_schedule_time(schedule: str | None) -> tuple[int, int] | None:
    """'15:30 Asia/Shanghai' 或 '15:30' → (15, 30)。"""
    if not schedule:
        return None
    hm = schedule.strip().split()[0]
    parts = hm.split(":")
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def tick(now: datetime | None = None) -> list[str]:
    """返回本次触发的任务 id 列表（便于测试）。全局开关关闭 → 空。"""
    now = now or datetime.now(_TZ)
    today = now.date().isoformat()
    triggered: list[str] = []
    with SessionLocal() as session:
        enabled_flag = session.get(Setting, "automationEnabled")
        if not (enabled_flag and enabled_flag.value):
            return []
        enabled = session.execute(select(AutomationTask).where(AutomationTask.enabled.is_(True))).scalars().all()
        for task in enabled:
            sched = _parse_schedule_time(task.schedule)
            if sched is None:
                continue
            hour, minute = sched
            is_after = now.hour > hour or (now.hour == hour and now.minute >= minute)
            run_key = f"lastAutomationTaskRun:{task.id}"
            last = session.get(Setting, run_key)
            last_date = last.value if last else None
            if is_after and last_date != today:
                # 先占位再执行（防重复，方案 §7.6）
                if last is None:
                    session.add(Setting(key=run_key, value=today))
                else:
                    last.value = today
                # 到点任务 defer 到 worker（同事务入队，§4.7）；未知类型也会落明确跳过日志。
                from app.queue import procrastinate_app

                is_daily = is_daily_briefing_task(task)
                run = create_automation_run(
                    session,
                    task_id=task.id,
                    kind="daily_briefing" if is_daily else f"task:{str(task.id)[:27]}",
                    trigger="schedule",
                    requested_by=task.execution_owner_id,
                )
                job = procrastinate_app.tasks["fk:run_daily" if is_daily else "fk:run_automation"]
                run.queue_job_id = job.configure(connection=session.connection()).defer(run_id=str(run.id))
                session.commit()
                triggered.append(str(task.id))
    return triggered
