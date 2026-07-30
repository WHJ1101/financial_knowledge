"""持仓/自选 CRUD API（方案 §3.4/§9.4）。隔离资源，属主校验，写操作过 CSRF。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.core.authz import require_owner
from app.db import get_session
from app.models import Instrument, LlmProfile, Position, User, WatchlistItem
from app.repositories.scoping import scoped_get, scoped_select
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


def _instrument_map(session: Session, insts: list[uuid.UUID]) -> dict[uuid.UUID, Instrument]:
    if not insts:
        return {}
    rows = session.execute(select(Instrument).where(Instrument.id.in_(insts))).scalars().all()
    return {i.id: i for i in rows}


def _watchlist_view(item: WatchlistItem, inst: Instrument | None) -> WatchlistItemView:
    return WatchlistItemView(
        id=item.id,
        instrument_id=item.instrument_id,
        code=inst.display_code if inst else "",
        name=inst.name if inst else "",
        market=inst.market if inst else "",
        status=item.status,
        thesis=item.thesis,
        advice=item.advice,
        risk=item.risk,
        watch_signals=item.watch_signals,
        analysis_status=item.analysis_status,
    )


def _position_view(pos: Position, inst: Instrument | None) -> PositionView:
    return PositionView(
        id=pos.id,
        instrument_id=pos.instrument_id,
        code=inst.display_code if inst else "",
        name=inst.name if inst else "",
        market=inst.market if inst else "",
        shares=float(pos.shares),
        cost=float(pos.cost),
        reason=pos.reason,
        risk=pos.risk,
        analysis_detail=pos.analysis_detail,
        analysis_status=pos.analysis_status,
    )


# ---- 自选 ----


@router.get("/watchlist", response_model=list[WatchlistItemView])
def list_watchlist(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[WatchlistItemView]:
    items = list(session.execute(scoped_select(WatchlistItem, user.id)).scalars().all())
    imap = _instrument_map(session, [i.instrument_id for i in items])
    return [_watchlist_view(i, imap.get(i.instrument_id)) for i in items]


@router.post("/watchlist", response_model=WatchlistItemView, dependencies=[Depends(require_csrf)])
def add_watchlist(
    body: WatchlistUpsertRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> WatchlistItemView:
    inst = resolve_or_create_instrument(session, body.code, body.market, body.name)
    now = datetime.now(UTC)
    existing = session.execute(
        scoped_select(WatchlistItem, user.id).where(WatchlistItem.instrument_id == inst.id)
    ).scalar_one_or_none()
    if existing:
        existing.status = body.status
        existing.thesis = body.thesis
        existing.advice = body.advice
        existing.risk = body.risk
        existing.updated_at = now
        session.commit()
        return _watchlist_view(existing, inst)
    item = WatchlistItem(
        id=uuid.uuid4(),
        owner_id=user.id,
        instrument_id=inst.id,
        status=body.status,
        thesis=body.thesis,
        advice=body.advice,
        risk=body.risk,
        analysis_status="pending",
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    session.commit()
    return _watchlist_view(item, inst)


@router.delete("/watchlist/{item_id}", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def delete_watchlist(
    item_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    item = scoped_get(session, WatchlistItem, item_id, user.id)
    require_owner(item.owner_id if item else None, user.id)
    assert item is not None
    session.delete(item)
    session.commit()
    return OkResponse()


# ---- 持仓 ----


@router.get("/positions", response_model=list[PositionView])
def list_positions(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[PositionView]:
    rows = list(session.execute(scoped_select(Position, user.id)).scalars().all())
    imap = _instrument_map(session, [p.instrument_id for p in rows])
    return [_position_view(p, imap.get(p.instrument_id)) for p in rows]


@router.post("/positions", response_model=PositionView, dependencies=[Depends(require_csrf)])
def add_position(
    body: PositionUpsertRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PositionView:
    inst = resolve_or_create_instrument(session, body.code, body.market, body.name)
    now = datetime.now(UTC)
    pos = Position(
        id=uuid.uuid4(),
        owner_id=user.id,
        instrument_id=inst.id,
        shares=body.shares,
        cost=body.cost,
        reason=body.reason,
        risk=body.risk,
        analysis_status="pending",
        created_at=now,
        updated_at=now,
    )
    session.add(pos)
    session.commit()
    return _position_view(pos, inst)


@router.patch("/positions/{pos_id}", response_model=PositionView, dependencies=[Depends(require_csrf)])
def update_position(
    pos_id: uuid.UUID,
    body: PositionUpdateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PositionView:
    pos = scoped_get(session, Position, pos_id, user.id)
    require_owner(pos.owner_id if pos else None, user.id)
    assert pos is not None  # require_owner 已保证
    pos.shares = body.shares
    pos.cost = body.cost
    pos.updated_at = datetime.now(UTC)
    session.commit()
    return _position_view(pos, session.get(Instrument, pos.instrument_id))


@router.delete("/positions/{pos_id}", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def delete_position(
    pos_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    pos = scoped_get(session, Position, pos_id, user.id)
    require_owner(pos.owner_id if pos else None, user.id)
    assert pos is not None
    session.delete(pos)
    session.commit()
    return OkResponse()


# ---- 智能分析（异步 worker 任务，BYOK 执行身份，方案 §11.4）----


class AnalyzeAccepted(BaseModel):
    status: str = "analyzing"


@router.post(
    "/watchlist/{item_id}/analyze",
    response_model=AnalyzeAccepted,
    status_code=202,
    dependencies=[Depends(require_csrf)],
)
def analyze_watchlist_item(
    item_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> AnalyzeAccepted:
    """触发自选分析（仅 owner=self）。未配 BYOK key → 422。同事务入队（§4.7）。"""
    item = scoped_get(session, WatchlistItem, item_id, user.id)
    require_owner(item.owner_id if item else None, user.id)
    if (
        session.execute(
            scoped_select(LlmProfile, user.id).where(
                LlmProfile.enabled.is_(True), LlmProfile.is_default.is_(True)
            )
        ).first()
        is None
    ):
        raise HTTPException(status_code=422, detail="llm_unavailable")
    from app.queue import procrastinate_app

    task = procrastinate_app.tasks["fk:analyze_watchlist"]
    task.configure(connection=session.connection()).defer(item_id=str(item_id))
    session.commit()
    return AnalyzeAccepted()


@router.post(
    "/positions/{pos_id}/analyze", response_model=AnalyzeAccepted, status_code=202, dependencies=[Depends(require_csrf)]
)
def analyze_position_endpoint(
    pos_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> AnalyzeAccepted:
    """触发持仓分析（仅 owner=self）。未配 BYOK key → 422。同事务入队（§4.7）。"""
    pos = scoped_get(session, Position, pos_id, user.id)
    require_owner(pos.owner_id if pos else None, user.id)
    assert pos is not None
    if (
        session.execute(
            scoped_select(LlmProfile, user.id).where(
                LlmProfile.enabled.is_(True), LlmProfile.is_default.is_(True)
            )
        ).first()
        is None
    ):
        raise HTTPException(status_code=422, detail="llm_unavailable")
    from app.queue import procrastinate_app

    pos.analysis_status = "analyzing"
    pos.updated_at = datetime.now(UTC)
    task = procrastinate_app.tasks["fk:analyze_position"]
    task.configure(connection=session.connection()).defer(pos_id=str(pos_id))
    session.commit()
    return AnalyzeAccepted()


# ---- 组合历史曲线（方案 §11.7）----


@router.get("/portfolio/history")
def portfolio_history(
    range: str = "6m",
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """组合市值/盈亏走势（按 owner 隔离，读 daily_bars 现算）。"""
    from app.services.portfolio_history import get_portfolio_history

    try:
        return get_portfolio_history(session, user.id, range)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/portfolio/history/sync", status_code=201, dependencies=[Depends(require_csrf)])
async def portfolio_history_sync(
    admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """回补当前超管本人持仓历史日线到公共 daily_bars。"""
    from app.services.portfolio_history import sync_portfolio_bars

    results = await sync_portfolio_bars(session, admin.id)
    return {"results": results}


# ---- 组合分析（实时行情 + 分布/归因/健康度/主题穿透，方案 §11.4 补齐）----


@router.get("/portfolio/analysis")
async def portfolio_analysis(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """组合分析（按 owner 隔离）：批量取实时行情 → 现算分布/归因/健康度/主题穿透。"""
    from app.services.instrument_catalog.repository import provider_ref_map
    from app.services.market import resolve_batch
    from app.services.portfolio_analysis import build_analysis, build_holdings, build_overview

    rows = list(session.execute(scoped_select(Position, user.id)).scalars().all())
    imap = _instrument_map(session, [p.instrument_id for p in rows])
    # 组装行情 batch 输入：code=display_code，quoteSecid 优先 eastmoney provider id
    items: list[dict[str, Any]] = []
    holdings_raw: list[dict[str, Any]] = []
    for p in rows:
        inst = imap.get(p.instrument_id)
        if inst is None:
            continue
        secid = provider_ref_map(inst).get("eastmoney") or ""
        items.append({"code": inst.display_code, "quoteSecid": secid})
        holdings_raw.append(
            {
                "id": str(p.id),
                "code": inst.display_code,
                "name": inst.name,
                "market": inst.market,
                "shares": float(p.shares),
                "cost": float(p.cost),
                "reason": p.reason,
                "risk": p.risk,
                "analysisDetail": p.analysis_detail,
                "analysisStatus": p.analysis_status,
            }
        )
    quotes = await resolve_batch(session, items) if items else {}
    holdings = build_holdings(holdings_raw, {k: dict(v) for k, v in quotes.items()})
    return {
        "overview": build_overview(holdings),
        "analysis": build_analysis(holdings),
        "holdings": [
            {
                "id": h["id"],
                "code": h["code"],
                "name": h["name"],
                "market": h["market"],
                "shares": h["shares"],
                "cost": h["cost"],
                "price": h["price"],
                "changePct": h["changePct"],
                "quoteSource": h["quoteSource"],
                "marketValue": h["marketValue"],
                "pnl": h["pnl"],
                "pnlPct": h["pnlPct"],
                "weight": h["weight"],
                "risk": h.get("risk"),
                "reason": h.get("reason"),
                "analysisDetail": h.get("analysisDetail") or {},
                "analysisStatus": h.get("analysisStatus"),
            }
            for h in holdings
        ],
    }
