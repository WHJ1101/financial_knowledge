"""持仓/自选 CRUD API（方案 §3.4/§9.4）。隔离资源，属主校验，写操作过 CSRF。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf
from app.core.authz import require_owner
from app.db import get_session
from app.models import Position, User, WatchlistItem
from app.schemas.entities import (
    OkResponse,
    PositionUpdateRequest,
    PositionUpsertRequest,
    PositionView,
    WatchlistItemView,
    WatchlistUpsertRequest,
)
from app.services.instrument_service import resolve_or_create_instrument

router = APIRouter(prefix="/api/v1", tags=["portfolio"])


# ---- 自选 ----


@router.get("/watchlist", response_model=list[WatchlistItemView])
def list_watchlist(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[WatchlistItem]:
    return list(
        session.execute(select(WatchlistItem).where(WatchlistItem.owner_id == user.id)).scalars().all()
    )


@router.post("/watchlist", response_model=WatchlistItemView, dependencies=[Depends(require_csrf)])
def add_watchlist(
    body: WatchlistUpsertRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> WatchlistItem:
    inst = resolve_or_create_instrument(session, body.code, body.market, body.name)
    now = datetime.now(UTC)
    existing = session.execute(
        select(WatchlistItem).where(
            WatchlistItem.owner_id == user.id, WatchlistItem.instrument_id == inst.id
        )
    ).scalar_one_or_none()
    if existing:
        existing.status = body.status
        existing.thesis = body.thesis
        existing.advice = body.advice
        existing.risk = body.risk
        existing.updated_at = now
        session.commit()
        return existing
    item = WatchlistItem(
        id=uuid.uuid4(), owner_id=user.id, instrument_id=inst.id, status=body.status,
        thesis=body.thesis, advice=body.advice, risk=body.risk, analysis_status="pending",
        created_at=now, updated_at=now,
    )
    session.add(item)
    session.commit()
    return item


@router.delete("/watchlist/{item_id}", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def delete_watchlist(
    item_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    item = session.get(WatchlistItem, item_id)
    require_owner(item.owner_id if item else None, user.id)
    session.delete(item)
    session.commit()
    return OkResponse()


# ---- 持仓 ----


@router.get("/positions", response_model=list[PositionView])
def list_positions(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[Position]:
    return list(session.execute(select(Position).where(Position.owner_id == user.id)).scalars().all())


@router.post("/positions", response_model=PositionView, dependencies=[Depends(require_csrf)])
def add_position(
    body: PositionUpsertRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Position:
    inst = resolve_or_create_instrument(session, body.code, body.market, body.name)
    now = datetime.now(UTC)
    pos = Position(
        id=uuid.uuid4(), owner_id=user.id, instrument_id=inst.id, shares=body.shares, cost=body.cost,
        reason=body.reason, risk=body.risk, analysis_status="pending", created_at=now, updated_at=now,
    )
    session.add(pos)
    session.commit()
    return pos


@router.patch("/positions/{pos_id}", response_model=PositionView, dependencies=[Depends(require_csrf)])
def update_position(
    pos_id: uuid.UUID,
    body: PositionUpdateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Position:
    pos = session.get(Position, pos_id)
    require_owner(pos.owner_id if pos else None, user.id)
    assert pos is not None  # require_owner 已保证
    pos.shares = body.shares
    pos.cost = body.cost
    pos.updated_at = datetime.now(UTC)
    session.commit()
    return pos


@router.delete("/positions/{pos_id}", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def delete_position(
    pos_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    pos = session.get(Position, pos_id)
    require_owner(pos.owner_id if pos else None, user.id)
    session.delete(pos)
    session.commit()
    return OkResponse()
