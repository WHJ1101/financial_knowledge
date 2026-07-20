"""M11.6 调度 dispatcher tick 测试（方案 §14）。

到点且当天未跑 → 触发（占位 last_run）；全局开关关闭 → 不触发；已跑当天 → 不重复。
用 fake now 控制时间；日更任务会 defer 到 procrastinate（测试后清理入队 job）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, text

from app.db import SessionLocal
from app.models import AutomationTask, Setting
from app.services.scheduler_service import tick

_TZ = ZoneInfo("Asia/Shanghai")


@pytest.fixture
def daily_task():
    tid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            AutomationTask(
                id=tid,
                name="每日市场简报",
                scope="system",
                enabled=True,
                goal="g",
                implementation="日更简报",
                schedule="09:30 Asia/Shanghai",
                config={},
                created_at=datetime.now(_TZ),
                updated_at=datetime.now(_TZ),
            )
        )
        s.commit()
    yield tid
    with SessionLocal() as s:
        s.execute(delete(Setting).where(Setting.key == f"lastAutomationTaskRun:{tid}"))
        s.execute(delete(Setting).where(Setting.key == "automationEnabled"))
        s.execute(delete(AutomationTask).where(AutomationTask.id == tid))
        s.execute(
            text("DELETE FROM procrastinate_jobs WHERE task_name IN ('fk:run_daily_briefing', 'fk:run_automation')")
        )
        s.commit()


def _set_automation(enabled: bool) -> None:
    with SessionLocal() as s:
        row = s.get(Setting, "automationEnabled")
        if row is None:
            s.add(Setting(key="automationEnabled", value=enabled))
        else:
            row.value = enabled
        s.commit()


def test_tick_skips_when_automation_disabled(daily_task):
    _set_automation(False)
    triggered = tick(now=datetime(2026, 7, 15, 10, 0, tzinfo=_TZ))  # 已过 09:30
    assert triggered == []


def test_tick_triggers_after_schedule(daily_task):
    _set_automation(True)
    tid = daily_task
    # 10:00 > 09:30 且当天未跑 → 触发
    triggered = tick(now=datetime(2026, 7, 15, 10, 0, tzinfo=_TZ))
    assert str(tid) in triggered
    # 占位后再 tick 同一天 → 不重复
    again = tick(now=datetime(2026, 7, 15, 11, 0, tzinfo=_TZ))
    assert str(tid) not in again


def test_tick_before_schedule_no_trigger(daily_task):
    _set_automation(True)
    tid = daily_task
    # 08:00 < 09:30 → 不触发
    triggered = tick(now=datetime(2026, 7, 15, 8, 0, tzinfo=_TZ))
    assert str(tid) not in triggered


def test_tick_unknown_task_enqueues_auditable_generic_worker():
    tid = uuid.uuid4()
    with SessionLocal() as session:
        session.add(
            AutomationTask(
                id=tid,
                name="未来任务",
                scope="system",
                enabled=True,
                goal="g",
                implementation="尚未接入",
                schedule="09:30 Asia/Shanghai",
                config={},
                created_at=datetime.now(_TZ),
                updated_at=datetime.now(_TZ),
            )
        )
        session.commit()
    _set_automation(True)
    try:
        assert str(tid) in tick(now=datetime(2026, 7, 16, 10, 0, tzinfo=_TZ))
        with SessionLocal() as session:
            task_name = session.execute(
                text("SELECT task_name FROM procrastinate_jobs WHERE task_name='fk:run_automation' LIMIT 1")
            ).scalar_one()
            assert task_name == "fk:run_automation"
    finally:
        with SessionLocal() as session:
            session.execute(text("DELETE FROM procrastinate_jobs WHERE task_name='fk:run_automation'"))
            session.execute(delete(Setting).where(Setting.key == f"lastAutomationTaskRun:{tid}"))
            session.execute(delete(Setting).where(Setting.key == "automationEnabled"))
            session.execute(delete(AutomationTask).where(AutomationTask.id == tid))
            session.commit()
