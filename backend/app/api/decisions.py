"""决策/辩论 API（方案 §3.4/§7.7）。隔离资源，属主校验，ULID id。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from ulid import ULID

from app.core.auth import get_current_user, require_csrf
from app.core.authz import require_owner
from app.db import get_session
from app.models import Debate, Instrument, Position, User, UserLlmConfig, WatchlistItem

router = APIRouter(prefix="/api/v1", tags=["decisions"])


class CreateDebateRequest(BaseModel):
    instrument_id: uuid.UUID
    horizon: str = Field(default="swing", max_length=16)
    question: str | None = Field(default=None, max_length=500)


class DebateCreated(BaseModel):
    id: str
    status: str


class DebateView(BaseModel):
    id: str
    status: str
    progress: int
    stage: str | None
    verdict: str | None
    confidence: int | None
    report: dict[str, Any] | None
    error_code: str | None
    error_message: str | None


def _view(d: Debate) -> DebateView:
    return DebateView(
        id=d.id, status=d.status, progress=d.progress, stage=d.stage, verdict=d.verdict,
        confidence=d.confidence, report=d.report, error_code=d.error_code, error_message=d.error_message,
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
    owned = session.execute(
        select(Position.id).where(Position.owner_id == user.id, Position.instrument_id == inst.id)
    ).first() or session.execute(
        select(WatchlistItem.id).where(WatchlistItem.owner_id == user.id, WatchlistItem.instrument_id == inst.id)
    ).first()
    if not owned:
        raise HTTPException(status_code=400, detail="instrument_not_in_portfolio")
    # 未配 BYOK key → 422 llm_unavailable（方案 §7.7，不用他人 key）
    if session.get(UserLlmConfig, user.id) is None:
        raise HTTPException(status_code=422, detail="llm_unavailable")
    # 强制去重：同 owner+instrument 已有进行中辩论 → 409（方案 §7.7）
    active = session.execute(
        select(Debate).where(
            Debate.owner_id == user.id, Debate.instrument_id == inst.id,
            Debate.status.in_(("queued", "running")),
        )
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="duplicate_active")

    debate_id = str(ULID())
    now = datetime.now(UTC)
    debate = Debate(
        id=debate_id, owner_id=user.id, execution_owner_id=user.id, instrument_id=inst.id,
        graph_thread_id=f"decision:{user.id}:{debate_id}", status="queued", progress=0,
        created_at=now, updated_at=now,
    )
    session.add(debate)
    # 同事务原子入队（方案 §4.7）
    from app.tasks import run_debate

    run_debate.configure(connection=session.connection()).defer(debate_id=debate_id)
    session.commit()
    return DebateCreated(id=debate_id, status="queued")


@router.get("/debates", response_model=list[DebateView])
def list_debates(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[DebateView]:
    rows = session.execute(
        select(Debate).where(Debate.owner_id == user.id).order_by(Debate.created_at.desc()).limit(50)
    ).scalars().all()
    return [_view(d) for d in rows]


@router.get("/debates/{debate_id}", response_model=DebateView)
def get_debate(
    debate_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> DebateView:
    d = session.get(Debate, debate_id)
    require_owner(d.owner_id if d else None, user.id)
    assert d is not None
    return _view(d)


@router.post("/debates/{debate_id}/cancel", response_model=DebateView, dependencies=[Depends(require_csrf)])
def cancel_debate(
    debate_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> DebateView:
    d = session.get(Debate, debate_id)
    require_owner(d.owner_id if d else None, user.id)
    assert d is not None
    if d.status in ("done", "failed"):
        raise HTTPException(status_code=409, detail="already_terminal")
    d.status = "canceled"
    d.updated_at = datetime.now(UTC)
    session.commit()
    return _view(d)
