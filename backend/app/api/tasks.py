"""任务自动化 API（方案 §11.6，超管专属）。

automation_tasks CRUD + 启停 + 定时；系统日志读取；全局开关 + 日更定时。
全部限超管（scope=system，§4.4）；写操作过 CSRF；调度由 worker tick_scheduler 驱动（§7.6）。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_csrf, require_superadmin
from app.db import get_session
from app.models import AutomationRun, AutomationTask, Log, Setting, SourceSyncRun, User
from app.services.automation import is_daily_briefing_task
from app.services.run_lifecycle import automation_run_view, source_sync_run_view

router = APIRouter(prefix="/api/v1", tags=["automation"])

_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class TaskCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    goal: str = Field(min_length=1)
    implementation: str = Field(min_length=1)
    schedule: str | None = None


class ScheduleRequest(BaseModel):
    time: str = Field(min_length=1, max_length=32)


class ToggleAutomationRequest(BaseModel):
    enabled: bool | None = None


def _normalize_time(value: str | None) -> str | None:
    """'15:30' / '15:30 Asia/Shanghai' → '15:30'，非法 → None。"""
    if not value:
        return None
    hm = value.strip().split()[0]
    return hm if _TIME_RE.match(hm) else None


def _task_view(task: AutomationTask) -> dict[str, Any]:
    sched = _normalize_time(task.schedule)
    return {
        "id": str(task.id),
        "name": task.name,
        "enabled": task.enabled,
        "goal": task.goal,
        "implementation": task.implementation,
        "prompt": task.prompt,
        "schedule": f"{sched} Asia/Shanghai" if sched else (task.schedule or "手动触发"),
        "scheduleTime": sched or "",
        "executable": is_daily_briefing_task(task),
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.get("/automation/tasks")
def list_tasks(_: User = Depends(require_superadmin), session: Session = Depends(get_session)) -> dict[str, Any]:
    tasks = session.execute(select(AutomationTask).order_by(AutomationTask.created_at.desc())).scalars().all()
    return {"tasks": [_task_view(t) for t in tasks]}


@router.get("/automation/runs")
def list_automation_runs(
    kind: str | None = None,
    limit: int = 50,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    query = select(AutomationRun)
    if kind:
        query = query.where(AutomationRun.kind == kind)
    rows = session.execute(
        query.order_by(AutomationRun.created_at.desc()).limit(max(1, min(limit, 200)))
    ).scalars()
    return {"runs": [automation_run_view(run) for run in rows]}


@router.get("/automation/runs/{run_id}")
def get_automation_run(
    run_id: uuid.UUID,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(AutomationRun, run_id)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "run_not_found", "message": "运行记录不存在"},
        )
    return automation_run_view(run)


@router.get("/source-sync-runs")
def list_source_sync_runs(
    source_key: str | None = None,
    limit: int = 50,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    query = select(SourceSyncRun)
    if source_key:
        query = query.where(SourceSyncRun.source_key == source_key)
    rows = session.execute(
        query.order_by(SourceSyncRun.created_at.desc()).limit(max(1, min(limit, 200)))
    ).scalars()
    return {"runs": [source_sync_run_view(run) for run in rows]}


@router.get("/source-sync-runs/{run_id}")
def get_source_sync_run(
    run_id: uuid.UUID,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(SourceSyncRun, run_id)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "run_not_found", "message": "来源同步记录不存在"},
        )
    return source_sync_run_view(run)


@router.post("/automation/tasks", status_code=201, dependencies=[Depends(require_csrf)])
def create_task(
    body: TaskCreateRequest, admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, Any]:
    now = datetime.now(UTC)
    sched = _normalize_time(body.schedule)
    prompt = (
        f"任务名称：{body.name}\n任务目标：{body.goal}\n执行方式：{body.implementation}\n"
        "请在执行时先收集可复核证据，再输出结论、风险、下一步动作。"
    )
    task = AutomationTask(
        id=uuid.uuid4(),
        name=body.name,
        scope="system",
        execution_owner_id=admin.id,
        enabled=False,
        goal=body.goal,
        implementation=body.implementation,
        prompt=prompt,
        schedule=f"{sched} Asia/Shanghai" if sched else "手动触发",
        config={},
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    return {"task": _task_view(task)}


@router.post("/automation/tasks/{task_id}/toggle", dependencies=[Depends(require_csrf)])
def toggle_task(
    task_id: uuid.UUID, _: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, Any]:
    task = session.get(AutomationTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.enabled = not task.enabled
    task.updated_at = datetime.now(UTC)
    session.commit()
    return {"task": _task_view(task)}


@router.post("/automation/tasks/{task_id}/schedule", dependencies=[Depends(require_csrf)])
def update_task_schedule(
    task_id: uuid.UUID,
    body: ScheduleRequest,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    sched = _normalize_time(body.time)
    if sched is None:
        raise HTTPException(status_code=400, detail="请输入有效的执行时间，格式为 HH:mm")
    task = session.get(AutomationTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.schedule = f"{sched} Asia/Shanghai"
    task.updated_at = datetime.now(UTC)
    session.commit()
    return {"task": _task_view(task)}


@router.post("/automation/toggle", dependencies=[Depends(require_csrf)])
def toggle_automation(
    body: ToggleAutomationRequest, _: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """全局自动化开关（settings.automationEnabled）。tick_scheduler 读取（§7.6）。"""
    row = session.get(Setting, "automationEnabled")
    current = bool(row.value) if row else False
    next_val = body.enabled if body.enabled is not None else not current
    if row is None:
        session.add(Setting(key="automationEnabled", value=next_val))
    else:
        row.value = next_val
    session.commit()
    return {"settings": {"automationEnabled": next_val}}


@router.post("/settings/daily-schedule", dependencies=[Depends(require_csrf)])
def update_daily_schedule(
    body: ScheduleRequest, admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """设置日更简报定时（写 daily-research 任务 + settings 冗余）。"""
    sched = _normalize_time(body.time)
    if sched is None:
        raise HTTPException(status_code=400, detail="请输入有效的执行时间，格式为 HH:mm")
    row = session.get(Setting, "dailyScheduleTime")
    if row is None:
        session.add(Setting(key="dailyScheduleTime", value=sched))
    else:
        row.value = sched
    task = next(
        (item for item in session.execute(select(AutomationTask)).scalars() if is_daily_briefing_task(item)),
        None,
    )
    now = datetime.now(UTC)
    if task is None:
        task = AutomationTask(
            id=uuid.uuid4(),
            name="daily-research",
            scope="system",
            execution_owner_id=admin.id,
            enabled=False,
            goal="生成每日市场简报并回补压力与组合历史数据",
            implementation="每日市场简报",
            prompt="收集可复核的行情、新闻和社群信号，生成每日市场简报。",
            schedule=f"{sched} Asia/Shanghai",
            config={},
            created_at=now,
            updated_at=now,
        )
        session.add(task)
    else:
        task.schedule = f"{sched} Asia/Shanghai"
        task.updated_at = now
    session.commit()
    return {"settings": {"dailyScheduleTime": sched}, "task": _task_view(task)}


@router.get("/logs")
def list_logs(_: User = Depends(require_superadmin), session: Session = Depends(get_session)) -> dict[str, Any]:
    logs = session.execute(select(Log).order_by(Log.created_at.desc()).limit(200)).scalars().all()
    return {
        "logs": [
            {
                "id": lg.id,
                "type": lg.type,
                "message": lg.message,
                "meta": lg.log_metadata,
                "createdAt": lg.created_at,
                "localTime": lg.local_time,
            }
            for lg in logs
        ]
    }
