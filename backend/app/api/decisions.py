"""决策/辩论 API（方案 §3.4/§7.7）。隔离资源，属主校验，ULID id。

旧「每日决策指南」已被辩论决策取代（ADR-023）：不再提供生成端点；
GET /decisions 仅超管只读归档历史（decisions 表冻结写入，§4.4）。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ulid import ULID

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.core.authz import require_owner
from app.db import get_session
from app.models import Debate, Decision, Instrument, LlmProfile, Position, User, WatchlistItem

router = APIRouter(prefix="/api/v1", tags=["decisions"])
logger = logging.getLogger(__name__)


@router.get("/decisions")
def list_decisions(_: User = Depends(require_superadmin), session: Session = Depends(get_session)) -> dict[str, Any]:
    """旧每日决策只读归档（超管，ADR-023 冻结写入）。每天保留最新一条，按日期倒序。"""
    latest = select(Decision.date, func.max(Decision.created_at).label("mx")).group_by(Decision.date).subquery()
    rows = (
        session.execute(
            select(Decision)
            .join(latest, (Decision.date == latest.c.date) & (Decision.created_at == latest.c.mx))
            .order_by(Decision.date.desc())
            .limit(60)
        )
        .scalars()
        .all()
    )
    return {
        "decisions": [
            {
                "id": d.id,
                "date": d.date,
                "title": d.title,
                "summary": d.summary,
                "action": d.action,
                "market": d.market,
                "positionAdvice": d.position_advice,
                "stockAdvice": d.stock_advice,
                "reports": d.reports,
                "createdAt": d.created_at,
            }
            for d in rows
        ]
    }


class CreateDebateRequest(BaseModel):
    instrument_id: uuid.UUID
    horizon: Literal["short", "swing", "long"] = "swing"
    question: str | None = Field(default=None, max_length=500)


class DebateCreated(BaseModel):
    id: str
    status: str


class DebateView(BaseModel):
    id: str
    instrument_id: uuid.UUID
    instrument_name: str
    instrument_code: str
    horizon: str
    question: str | None
    status: str
    progress: int
    stage: str | None
    verdict: str | None
    confidence: int | None
    report: dict[str, Any] | None
    error_code: str | None
    error_message: str | None
    attempt: int
    model_assignments: dict[str, Any]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


def _view(d: Debate, instrument: Instrument | None = None) -> DebateView:
    return DebateView(
        id=d.id,
        instrument_id=d.instrument_id,
        instrument_name=instrument.name if instrument else "",
        instrument_code=instrument.display_code if instrument else "",
        horizon=d.horizon,
        question=d.question,
        status=d.status,
        progress=d.progress,
        stage=d.stage,
        verdict=d.verdict,
        confidence=d.confidence,
        report=d.report,
        error_code=d.error_code,
        error_message=d.error_message,
        attempt=d.attempt,
        model_assignments=d.model_assignments or {},
        created_at=d.created_at,
        started_at=d.started_at,
        finished_at=d.finished_at,
        updated_at=d.updated_at,
    )


@router.post("/debates", response_model=DebateCreated, status_code=201, dependencies=[Depends(require_csrf)])
def create_debate(
    body: CreateDebateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> DebateCreated:
    # 服务端由 instrument_id 反查，不信前端 code/secid（方案 §7.2）
    inst = session.get(Instrument, body.instrument_id)
    if inst is None:
        raise HTTPException(status_code=400, detail="invalid_instrument")
    # 标的须在本人持仓或自选中（隔离，方案 §9.4）
    owned = (
        session.execute(
            select(Position.id).where(Position.owner_id == user.id, Position.instrument_id == inst.id)
        ).first()
        or session.execute(
            select(WatchlistItem.id).where(WatchlistItem.owner_id == user.id, WatchlistItem.instrument_id == inst.id)
        ).first()
    )
    if not owned:
        raise HTTPException(status_code=400, detail="instrument_not_in_portfolio")
    # 未配 BYOK key → 422 llm_unavailable（方案 §7.7，不用他人 key）
    if (
        session.execute(
            select(LlmProfile.id).where(
                LlmProfile.user_id == user.id,
                LlmProfile.enabled.is_(True),
                LlmProfile.is_default.is_(True),
            )
        ).first()
        is None
    ):
        raise HTTPException(status_code=422, detail="llm_unavailable")
    # 强制去重：同 owner+instrument 已有进行中辩论 → 409（方案 §7.7）
    active = session.execute(
        select(Debate).where(
            Debate.owner_id == user.id,
            Debate.instrument_id == inst.id,
            Debate.status.in_(("queued", "running")),
        )
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="duplicate_active")

    debate_id = str(ULID())
    now = datetime.now(UTC)
    debate = Debate(
        id=debate_id,
        owner_id=user.id,
        execution_owner_id=user.id,
        instrument_id=inst.id,
        graph_thread_id=f"decision:{user.id}:{debate_id}",
        horizon=body.horizon,
        question=body.question.strip() if body.question else None,
        status="queued",
        progress=0,
        attempt=0,
        model_assignments={},
        created_at=now,
        updated_at=now,
    )
    session.add(debate)
    # 同事务原子入队（方案 §4.7）：走 API 侧同步连接器 app 的已注册 task（namespace fk）
    from app.queue import procrastinate_app

    run_debate = procrastinate_app.tasks["fk:run_debate"]
    debate.queue_job_id = run_debate.configure(connection=session.connection()).defer(debate_id=debate_id)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if "uq_debates_owner_instrument_active" in str(exc.orig):
            raise HTTPException(status_code=409, detail="duplicate_active") from exc
        raise
    return DebateCreated(id=debate_id, status="queued")


@router.get("/debates", response_model=list[DebateView])
def list_debates(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[DebateView]:
    rows = session.execute(
        select(Debate, Instrument)
        .join(Instrument, Instrument.id == Debate.instrument_id)
        .where(Debate.owner_id == user.id)
        .order_by(Debate.created_at.desc())
        .limit(50)
    ).all()
    return [_view(debate, instrument) for debate, instrument in rows]


@router.get("/debates/{debate_id}", response_model=DebateView)
def get_debate(
    debate_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> DebateView:
    d = session.get(Debate, debate_id)
    require_owner(d.owner_id if d else None, user.id)
    assert d is not None
    return _view(d, session.get(Instrument, d.instrument_id))


@router.post("/debates/{debate_id}/cancel", response_model=DebateView, dependencies=[Depends(require_csrf)])
def cancel_debate(
    debate_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> DebateView:
    # 与 worker 的最终结果提交共用行锁，确保“取消先到则取消、完成先到则 409”。
    d = session.execute(select(Debate).where(Debate.id == debate_id).with_for_update()).scalar_one_or_none()
    require_owner(d.owner_id if d else None, user.id)
    assert d is not None
    if d.status in ("done", "failed"):
        raise HTTPException(status_code=409, detail="already_terminal")
    now = datetime.now(UTC)
    d.status = "canceled"
    d.cancel_requested_at = now
    d.stage = "已请求取消"
    d.finished_at = now
    d.updated_at = now
    session.commit()
    if d.queue_job_id is not None:
        from app.queue import cancel_job

        try:
            cancel_job(d.queue_job_id, abort_running=True)
        except Exception:  # noqa: BLE001 -- 业务取消标记已提交，worker 会在阶段边界协作停止
            logger.exception("队列取消请求失败，debate=%s job=%s", d.id, d.queue_job_id)
    return _view(d, session.get(Instrument, d.instrument_id))


@router.post("/debates/{debate_id}/resume", response_model=DebateView, dependencies=[Depends(require_csrf)])
def resume_debate(
    debate_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> DebateView:
    """失败任务复用原 graph_thread_id，从 PostgreSQL checkpoint 重新入队。"""
    d = session.execute(select(Debate).where(Debate.id == debate_id).with_for_update()).scalar_one_or_none()
    require_owner(d.owner_id if d else None, user.id)
    assert d is not None
    if d.status != "failed":
        raise HTTPException(status_code=409, detail="resume_not_allowed")
    if (
        session.execute(
            select(LlmProfile.id).where(
                LlmProfile.user_id == user.id,
                LlmProfile.enabled.is_(True),
                LlmProfile.is_default.is_(True),
            )
        ).first()
        is None
    ):
        raise HTTPException(status_code=422, detail="llm_unavailable")
    if session.execute(
        select(Debate.id).where(
            Debate.owner_id == user.id,
            Debate.instrument_id == d.instrument_id,
            Debate.id != d.id,
            Debate.status.in_(("queued", "running")),
        )
    ).first():
        raise HTTPException(status_code=409, detail="duplicate_active")

    d.status = "queued"
    d.progress = 0
    d.stage = "等待重试"
    d.error_code = None
    d.error_message = None
    d.finished_at = None
    d.cancel_requested_at = None
    d.updated_at = datetime.now(UTC)
    from app.queue import procrastinate_app

    run_debate = procrastinate_app.tasks["fk:run_debate"]
    d.queue_job_id = run_debate.configure(connection=session.connection()).defer(debate_id=d.id)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if "uq_debates_owner_instrument_active" in str(exc.orig):
            raise HTTPException(status_code=409, detail="duplicate_active") from exc
        raise
    return _view(d, session.get(Instrument, d.instrument_id))
