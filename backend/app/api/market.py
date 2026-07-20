"""行情 API（方案 §3.4/§11.1）。

公共只读（登录成员）：/market/snapshot /market/indices /search /quote/{secid} /quotes/batch。
写手动行情覆盖限超管：POST/DELETE /quote-overrides（§3.4：手动行情属系统数据）。
写操作过 CSRF；覆盖增删写审计日志（append_log）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.models import User
from app.providers.eastmoney import search_stocks
from app.services.logs import append_log
from app.services.market import (
    delete_quote_override,
    get_indices,
    get_market_snapshot,
    resolve_batch,
    resolve_quote,
    upsert_quote_override,
)
from app.services.market_calendar import market_sessions

router = APIRouter(prefix="/api/v1", tags=["market"])


class QuoteBatchItem(BaseModel):
    code: str
    quoteSecid: str | None = None


class QuoteBatchRequest(BaseModel):
    items: list[QuoteBatchItem] = Field(default_factory=list)


class QuoteOverrideRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    price: float = Field(gt=0)
    name: str | None = None
    market: str | None = None
    changePct: str | None = None
    sourceLabel: str | None = None
    note: str | None = None


@router.get("/market/snapshot")
def market_snapshot(_: User = Depends(get_current_user)) -> dict[str, Any]:
    return get_market_snapshot()


@router.get("/market/sessions")
def market_session_status(_: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"sessions": market_sessions()}


@router.get("/market/indices")
def market_indices(_: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, Any]:
    return {"indices": get_indices(session)}


@router.get("/search")
async def search(q: str = Query(min_length=1), _: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"results": await search_stocks(q)}


@router.get("/quote/{secid:path}")
async def quote(
    secid: str, _: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    result = await resolve_quote(session, secid)
    if result is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return dict(result)


@router.post("/quotes/batch", dependencies=[Depends(require_csrf)])
async def quotes_batch(
    body: QuoteBatchRequest,
    _: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    items = [item.model_dump() for item in body.items]
    quotes = await resolve_batch(session, items)
    return {"quotes": quotes}


@router.post("/quote-overrides", dependencies=[Depends(require_csrf)])
def create_quote_override(
    body: QuoteOverrideRequest,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        quote = upsert_quote_override(session, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    append_log(
        session,
        "quote_override",
        f"Saved manual quote override: {body.code}",
        {"code": body.code, "price": body.price, "sourceLabel": quote.get("sourceLabel", "手动行情")},
    )
    session.commit()
    return {"quote": quote}


@router.delete("/quote-overrides/{code:path}", dependencies=[Depends(require_csrf)])
def remove_quote_override(
    code: str, _: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> dict[str, bool]:
    deleted = delete_quote_override(session, code)
    if deleted:
        append_log(session, "quote_override", f"Deleted manual quote override: {code}", {"code": code})
    session.commit()
    return {"deleted": deleted}
