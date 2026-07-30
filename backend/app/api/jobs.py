"""研报生产 / 日更 API（方案 §11.2）。

POST /research：按主题生成研究报告（BYOK LLM，未配 key 降级证据草稿）。属主=请求者，默认 private。
POST /jobs/daily：创建日更运行并原子入队，返回 202 与运行 ID。

研究流水线同步（读本地源 + 同步 chat），走 FastAPI 线程池；日更由 Worker 异步执行。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.llm.client import try_make_sync_chat
from app.models import AutomationRun, Report, User
from app.repositories.scoping import scoped_select
from app.services.report_lifecycle import create_report
from app.services.research import Brief, run_research_pipeline
from app.services.run_lifecycle import create_automation_run

router = APIRouter(prefix="/api/v1", tags=["jobs"])


class ResearchRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    type: str = Field(default="custom", max_length=32)


class ReportCreated(BaseModel):
    id: str
    title: str
    type: str
    summary: str | None


class AutomationRunCreated(BaseModel):
    run_id: str
    status: str
    poll_url: str


def _previous_reports(session: Session, user: User) -> list[dict[str, object]]:
    """研究可参考的历史报告（可见：shared 或自有），供 pipeline 历史证据。"""
    rows = (
        session.execute(
            scoped_select(Report, user.id, access="visible")
            .order_by(Report.created_at.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "title": r.title,
            "topic": r.topic,
            "type": r.type,
            "summary": r.summary,
            "tags": r.tags,
            "highlights": r.highlights,
            "createdAt": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/research", response_model=ReportCreated, status_code=201, dependencies=[Depends(require_csrf)])
def create_research(
    body: ResearchRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ReportCreated:
    settings = get_settings()
    # BYOK：未配 key → chat=None，pipeline 降级为证据草稿（不回退全局，方案 ADR-017）
    chat, model = try_make_sync_chat(session, str(user.id), "research", f"research:{user.id}")
    previous = _previous_reports(session, user)
    brief = run_research_pipeline(
        chat,
        body.topic,
        body.type,
        settings.data_dir,
        previous,
        generated_at=datetime.now(UTC).isoformat(),
        model=model,
    )
    report = create_report(session, user, body.topic, body.type, _brief_dict(brief), source="page")
    return ReportCreated(id=report.id, title=report.title, type=report.type, summary=report.summary)


@router.post(
    "/jobs/daily",
    response_model=AutomationRunCreated,
    status_code=202,
    dependencies=[Depends(require_csrf)],
)
def enqueue_daily(
    admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> AutomationRunCreated:
    """同事务写运行台账与队列 Job，避免存在无任务运行或无台账任务。"""
    try:
        run = create_automation_run(
            session,
            kind="daily_briefing",
            trigger="manual",
            requested_by=admin.id,
        )
        from app.queue import procrastinate_app

        task = procrastinate_app.tasks["fk:run_daily"]
        run.queue_job_id = task.configure(connection=session.connection()).defer(run_id=str(run.id))
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        active = session.execute(
            select(AutomationRun)
            .where(
                AutomationRun.kind == "daily_briefing",
                AutomationRun.status.in_(("queued", "running")),
            )
            .order_by(AutomationRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "active_run_exists",
                "run_id": str(active.id) if active else None,
                "message": "已有日更任务正在排队或执行",
            },
        ) from exc
    except Exception as exc:
        session.rollback()
        raise HTTPException(
            status_code=503,
            detail={"code": "queue_defer_failed", "message": "日更任务入队失败，请稍后重试"},
        ) from exc
    return AutomationRunCreated(
        run_id=str(run.id),
        status=run.status,
        poll_url=f"/api/v1/automation/runs/{run.id}",
    )


def _brief_dict(brief: Brief) -> dict[str, object]:
    """research.Brief → 报告模板/落库所需 dict（camelCase 对齐模板）。"""
    return {
        "summary": brief.summary,
        "highlights": brief.highlights,
        "watchList": brief.watch_list,
        "risks": brief.risks,
        "nextSteps": brief.next_steps,
        "tags": brief.tags,
        "evidence": brief.evidence,
        "dataQuality": brief.data_quality,
    }
