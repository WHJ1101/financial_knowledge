"""研报生产 / 日更 API（方案 §11.2）。

POST /research：按主题生成研究报告（BYOK LLM，未配 key 降级证据草稿）。属主=请求者，默认 private。
POST /jobs/daily：生成每日市场简报（自动化产出，超管触发，owner=超管）。异步抓取行情/快讯。

研究流水线同步（读本地源 + 同步 chat），走 FastAPI 线程池；日更含外部抓取用 async。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.llm.client import try_make_sync_chat
from app.models import Report, User
from app.services.automation import run_daily_job
from app.services.report_lifecycle import create_report
from app.services.research import Brief, run_research_pipeline

router = APIRouter(prefix="/api/v1", tags=["jobs"])


class ResearchRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    type: str = Field(default="custom", max_length=32)


class ReportCreated(BaseModel):
    id: str
    title: str
    type: str
    summary: str | None


def _previous_reports(session: Session, user: User) -> list[dict[str, object]]:
    """研究可参考的历史报告（可见：shared 或自有），供 pipeline 历史证据。"""
    from sqlalchemy import or_

    rows = (
        session.execute(
            select(Report)
            .where(or_(Report.visibility == "shared", Report.owner_id == user.id))
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


@router.post("/jobs/daily", response_model=ReportCreated, status_code=201, dependencies=[Depends(require_csrf)])
async def run_daily(
    admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> ReportCreated:
    result = await run_daily_job(session, admin, source="daily")
    report = result["report"]
    return ReportCreated(id=report.id, title=report.title, type=report.type, summary=report.summary)


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
