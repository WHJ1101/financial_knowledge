"""动态调度 dispatcher（方案 §7.6）。

tick 每分钟跑：读 automation_tasks enabled 任务，到点且当天未跑 → defer 业务任务。
先占位（settings 记 last_run=当天）再执行，重叠防护（对齐 scheduler.js:26 语义）。
M8 接入具体业务任务（日报）。
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AutomationTask, Setting

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
    """返回本次触发的任务 id 列表（便于测试）。"""
    now = now or datetime.now(_TZ)
    today = now.date().isoformat()
    triggered: list[str] = []
    with SessionLocal() as session:
        enabled = session.execute(
            select(AutomationTask).where(AutomationTask.enabled.is_(True))
        ).scalars().all()
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
                session.commit()
                triggered.append(str(task.id))
                # M8：此处 defer 具体业务任务（如日报生成）
    return triggered
