"""行情编排服务（移植 market-data.js 缓存/轮询 + routes/market.js + routes/quotes.js，方案 M11.1）。

- 指数快照内存缓存 + 交易时段轮询（旧 startMarketPoller，改由 FastAPI lifespan 驱动）。
- 批量行情：外部实时优先，降级 quote_overrides 手动行情（公共/超管写）。
- indices：DB market_indices ⋈ live 缓存（CODE_MAP 处理 code 不一致）。

异步抓取用 providers.eastmoney（httpx.AsyncClient）；DB 读写走同步 Session。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MarketIndex, QuoteOverride
from app.providers.eastmoney import (
    IndexLive,
    MarketQuote,
    fetch_index_list,
    get_stock_quote,
    search_stocks,
)

_TZ = ZoneInfo("Asia/Shanghai")
logger = logging.getLogger(__name__)
_BATCH_LIMIT = 80  # 旧 getBatchQuotes 上限
# DB code → live code 映射（处理 code 不一致，移植 routes/market.js CODE_MAP）
_CODE_MAP = {"IXIC.US": "NDX", "SPX.US": "SPX", "HSI.HK": "HSI"}


class _IndexCache:
    """指数快照内存缓存（等价旧模块级 cache={data,updatedAt}）。"""

    def __init__(self) -> None:
        self.data: list[IndexLive] = []
        self.updated_at: str | None = None
        self.attempted_at: str | None = None
        self.last_error: str | None = None


_cache = _IndexCache()


def get_market_snapshot() -> dict[str, Any]:
    """返回当前缓存的指数快照（供 GET /market/snapshot）。"""
    if _cache.last_error is not None:
        status = "stale" if _cache.data else "unavailable"
    elif _cache.attempted_at is None:
        status = "loading"
    else:
        status = "ok" if _cache.data else "empty"
    return {
        "indices": _cache.data,
        "updatedAt": _cache.updated_at,
        "attemptedAt": _cache.attempted_at,
        "status": status,
    }


async def refresh_market_cache() -> None:
    """抓取指数快照写入缓存（轮询任务调用）。失败保留旧缓存。"""
    _cache.attempted_at = datetime.now(UTC).isoformat()
    try:
        _cache.data = await fetch_index_list()
        _cache.updated_at = datetime.now(UTC).isoformat()
        _cache.last_error = None
    except Exception as exc:  # noqa: BLE001 —— 轮询容错，保留旧缓存
        _cache.last_error = type(exc).__name__
        logger.warning("行情快照刷新失败，继续使用上一次成功缓存：%s", _cache.last_error)


def is_trading_hours(now: datetime | None = None) -> bool:
    """A股交易时段粗判（周一~周五 9~15 点，Asia/Shanghai），移植 isTradingHours。"""
    dt = (now or datetime.now(UTC)).astimezone(_TZ)
    return dt.weekday() < 5 and 9 <= dt.hour <= 15


def get_indices(session: Session) -> list[dict[str, Any]]:
    """DB market_indices 合并 live 缓存（移植 getIndices）。"""
    rows = session.execute(select(MarketIndex)).scalars().all()
    live = _cache.data
    out: list[dict[str, Any]] = []
    for row in rows:
        live_code = _CODE_MAP.get(row.code)
        live_item = next(
            (d for d in live if d["code"] == live_code or (d["code"] and d["code"] in row.code)),
            None,
        )
        out.append(
            {
                "code": row.code,
                "region": row.region,
                "name": row.name,
                "level": (live_item and live_item["level"]) or row.level or "待接入",
                "changePct": (live_item and live_item["changePct"]) or row.change_pct or "待接入",
                "volume": (live_item and live_item["volume"]) or row.volume or None,
                "relatedEtfs": row.related_etfs or [],
                "updatedAt": _cache.updated_at or (row.updated_at.isoformat() if row.updated_at else None),
            }
        )
    return out


# ---- 手动行情覆盖（quote_overrides，公共/超管写，§3.4）----


def _format_override(row: QuoteOverride) -> MarketQuote:
    price = float(row.price)
    return MarketQuote(
        name=row.name or row.code,
        price=price,
        market=row.market or "手动",
        high=price,
        low=price,
        open=price,
        changePct=row.change_pct or "0.00",
        source="manual",
        sourceLabel=row.source_label or "手动行情",
        note=row.note or "",
        updatedAt=row.updated_at.isoformat() if row.updated_at else "",
    )


def get_quote_override(session: Session, *keys: str) -> MarketQuote | None:
    """按 code 键查手动行情（去重、保序），无则 None。"""
    seen: list[str] = []
    for k in keys:
        k = str(k or "").strip()
        if k and k not in seen:
            seen.append(k)
    for key in seen:
        row = session.get(QuoteOverride, key)
        if row is not None:
            return _format_override(row)
    return None


async def resolve_quote(session: Session, code: str, quote_secid: str | None = None) -> MarketQuote | None:
    """单标的行情解析（实时→手动兜底），移植 getStockQuote + getManualQuote。"""
    normalized = str(quote_secid or code or "").strip()
    code = str(code or "").strip()
    quote = await get_stock_quote(normalized) if normalized else None
    if quote is not None:
        return quote
    return get_quote_override(session, normalized, code)


async def resolve_batch(session: Session, items: list[dict[str, Any]]) -> dict[str, MarketQuote]:
    """批量行情（≤80 条），移植 getBatchQuotes + resolveQuoteForItem。

    实时抓取并发；每项失败降级搜索匹配后重试，再降级手动行情。
    """
    limited = items[:_BATCH_LIMIT]

    async def _resolve_item(item: dict[str, Any]) -> MarketQuote | None:
        code = str(item.get("code") or "").strip()
        quote_secid = str(item.get("quoteSecid") or item.get("quote_secid") or "").strip()
        direct = await get_stock_quote(quote_secid or code) if (quote_secid or code) else None
        if direct is not None:
            return direct
        if quote_secid and quote_secid != code and code:
            by_code = await get_stock_quote(code)
            if by_code is not None:
                return by_code
        # 搜索匹配后再取一次实时
        try:
            results = await search_stocks(code) if code else []
        except Exception:  # noqa: BLE001 —— 搜索容错
            results = []
        match = next((r for r in results if r["code"] == code), results[0] if results else None)
        if match and match["secid"]:
            hit = await get_stock_quote(match["secid"])
            if hit is not None:
                return hit
        return None

    codes = [str(item.get("code") or "").strip() for item in limited]
    live_quotes = await asyncio.gather(*(_resolve_item(item) for item in limited))
    out: dict[str, MarketQuote] = {}
    for code, item, quote in zip(codes, limited, live_quotes, strict=True):
        if not code:
            continue
        if quote is None:  # 实时全失败 → 手动行情兜底（同步 DB 查）
            quote_secid = str(item.get("quoteSecid") or item.get("quote_secid") or "").strip()
            quote = get_quote_override(session, quote_secid, code)
        if quote is not None:
            out[code] = quote
    return out


def upsert_quote_override(session: Session, body: dict[str, Any]) -> MarketQuote:
    """写手动行情覆盖（移植 upsertQuoteOverride）。price 必须为正。"""
    code = str(body.get("code") or "").strip()
    if not code:
        raise ValueError("code required")
    try:
        price = float(body.get("price"))  # type: ignore[arg-type]  # None → TypeError（下方捕获）
    except (ValueError, TypeError) as e:
        raise ValueError("price must be positive") from e
    if price <= 0:
        raise ValueError("price must be positive")
    change_pct = body.get("changePct")
    row = session.get(QuoteOverride, code)
    now = datetime.now(UTC)
    if row is None:
        row = QuoteOverride(code=code, price=price, updated_at=now)
        session.add(row)
    row.name = str(body.get("name") or "").strip()
    row.market = str(body.get("market") or "").strip()
    row.price = price
    row.change_pct = None if change_pct is None else str(change_pct).strip()
    row.source_label = str(body.get("sourceLabel") or "手动行情").strip()
    row.note = str(body.get("note") or "").strip()
    row.updated_at = now
    session.flush()
    return _format_override(row)


def delete_quote_override(session: Session, code: str) -> bool:
    """删手动行情覆盖，返回是否删除（移植 deleteQuoteOverride）。"""
    row = session.get(QuoteOverride, code)
    if row is None:
        return False
    session.delete(row)
    return True
