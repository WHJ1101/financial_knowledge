"""组合市值/盈亏走势曲线（移植 lib/portfolio-series.js + portfolio-history.js + kline-store 回补，方案 §11.7）。

- build_portfolio_series：纯计算，按当前持仓结构回溯逐日 [{date,marketValue,pnl,pnlPct,coveredCount}]。
  口径：S(t)=截至 t 已现价的标的集合（成分逐日入场，避免上市前虚增）；成本基线随 S(t) 动态收敛。
- resolve_bar_secid：持仓 → daily_bars 主键 secid（基金分支最先短路；A股/ETF 按号段补前缀）。
- sync_portfolio_bars：抓历史前复权价/净值落 daily_bars（交易所判定取不到数回退试基金）。
- get_portfolio_history：读 daily_bars 现算 + range 截取 + coverage/asOf（查询层零联网）。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import DailyBar, Instrument, Position
from app.repositories.scoping import scoped_select

_DAY = timedelta(days=1)
_RANGE_DAYS = {"6m": 190}  # 半年约 126 交易日，留冗余按自然日 190 截取
_SUPPORTED_MARKETS = ("A股", "ETF", "深市主板", "沪市主板", "科创板", "创业板")


@dataclass
class Holding:
    secid: str
    shares: float
    cost: float
    has_cost: bool


def build_portfolio_series(
    holdings: list[Holding], bars_by_secid: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    """逐日组合序列（纯函数，移植 buildPortfolioSeries）。"""
    if not holdings:
        return []
    prepared: list[dict[str, Any]] = []
    for h in holdings:
        date_close: dict[str, float] = {}
        for bar in bars_by_secid.get(h.secid, []):
            close = bar.get("close")
            if not bar.get("date") or close is None:
                continue
            try:
                cval = float(close)
            except (ValueError, TypeError):
                continue
            if cval > 0:
                date_close[bar["date"]] = cval  # 同日后写覆盖
        prepared.append({"h": h, "map": date_close, "last": None, "started": False})

    all_dates: set[str] = set()
    for p in prepared:
        all_dates.update(p["map"].keys())
    dates = sorted(all_dates)
    if not dates:
        return []

    out: list[dict[str, Any]] = []
    for date in dates:
        market_value = costed_value = total_cost = 0.0
        covered = 0
        for p in prepared:
            if date in p["map"]:
                p["last"] = p["map"][date]
                p["started"] = True
            if not p["started"]:
                continue
            covered += 1
            h = p["h"]
            value = h.shares * p["last"]
            market_value += value
            if h.has_cost:
                costed_value += value
                total_cost += h.shares * h.cost
        pnl = costed_value - total_cost
        out.append(
            {
                "date": date,
                "marketValue": market_value,
                "pnl": pnl,
                "pnlPct": (pnl / total_cost * 100) if total_cost else None,
                "coveredCount": covered,
            }
        )
    return out


# ---- secid 归类（instrument → daily_bars 主键，移植 classifyBarSecid）----


def _exchange_secid_from_code(code: str) -> str | None:
    """深市 0/15/16/18/3 → 0.；沪市 5/6 → 1.。"""
    if not re.match(r"^\d{6}$", code):
        return None
    if re.match(r"^(0|15|16|18|3)", code):
        return f"0.{code}"
    if re.match(r"^(5|6)", code):
        return f"1.{code}"
    return None


def resolve_bar_secid(inst: Instrument) -> tuple[str, str] | None:
    """instrument → (secid, kind)。kind ∈ exchange|fund。不支持（港美股）→ None。

    基金分支最先短路；否则优先 Provider Ref，再按 market+号段补前缀。
    """
    code = inst.canonical_symbol
    market = inst.market or ""
    # ① 场外基金
    if (inst.asset_class == "open_end_fund" or "基金" in market) and re.match(r"^\d{6}$", code):
        return f"OF.{code}", "fund"
    # ② 港股/美股不支持
    if re.search(r"港|美|hk|us", market, re.I):
        return None
    if inst.asset_class in ("hk_stock", "us_stock"):
        return None
    # ③ Provider Ref 已有交易所 secid
    from app.services.instrument_catalog.repository import provider_ref_map

    em = provider_ref_map(inst).get("eastmoney")
    if em and re.match(r"^(0|1)\.\d{6}$", em):
        return em, "exchange"
    # ④ A股/ETF 按号段补前缀
    if re.match(r"^\d{6}$", code) and any(m in market for m in _SUPPORTED_MARKETS):
        ex = _exchange_secid_from_code(code)
        if ex:
            return ex, "exchange"
    # ⑤ 兜底：纯 6 位无 market 提示，按号段推断
    ex = _exchange_secid_from_code(code)
    return (ex, "exchange") if ex else None


def _load_all_bars(session: Session, secid: str) -> list[dict[str, Any]]:
    rows = session.execute(select(DailyBar).where(DailyBar.secid == secid).order_by(DailyBar.date)).scalars().all()
    return [{"date": r.date, "close": r.close, "volume": r.volume} for r in rows]


def _local_day(dt: datetime) -> str:
    from zoneinfo import ZoneInfo

    return dt.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")


def get_portfolio_history(
    session: Session, owner_id: uuid.UUID, range_: str = "6m", now: datetime | None = None
) -> dict[str, Any]:
    """组合曲线查询（读 daily_bars 现算，按 owner 隔离）。移植 getPortfolioHistory。"""
    if range_ not in ("6m", "all"):
        raise ValueError("range must be 6m or all")
    now = now or datetime.now(UTC)
    positions = session.execute(
        scoped_select(Position, owner_id)
        .add_columns(Instrument)
        .join(Instrument, Position.instrument_id == Instrument.id)
    ).all()

    holdings: list[Holding] = []
    bars_by_secid: dict[str, list[dict[str, Any]]] = {}
    skipped: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    for pos, inst in positions:
        resolved = resolve_bar_secid(inst)
        if resolved is None:
            skipped.append({"code": inst.display_code, "name": inst.name, "reason": "unsupported-or-no-secid"})
            continue
        secid, _kind = resolved
        bars = _load_all_bars(session, secid)
        if not bars:
            skipped.append({"code": inst.display_code, "name": inst.name, "secid": secid, "reason": "no-bars"})
            continue
        cost = float(pos.cost or 0)
        holdings.append(Holding(secid=secid, shares=float(pos.shares or 0), cost=cost, has_cost=cost > 0))
        bars_by_secid[secid] = bars
        assets.append(
            {
                "code": inst.display_code,
                "name": inst.name,
                "secid": secid,
                "firstDate": bars[0]["date"],
                "lastDate": bars[-1]["date"],
                "barCount": len(bars),
            }
        )

    series = build_portfolio_series(holdings, bars_by_secid)
    as_of = series[-1]["date"] if series else None
    full_since = next((p["date"] for p in series if p["coveredCount"] >= len(holdings)), None) if holdings else None
    if range_ == "6m":
        cutoff = _local_day(now - _RANGE_DAYS["6m"] * _DAY)
        series = [p for p in series if p["date"] >= cutoff]

    total_cost = sum(float(p.shares or 0) * float(p.cost or 0) for p, _ in positions if float(p.cost or 0) > 0)
    covered_cost = sum(h.shares * h.cost for h in holdings if h.has_cost)
    return {
        "range": range_,
        "basis": "current-holdings",
        "calculationScope": "current-holdings" if len(holdings) == len(positions) else "covered-holdings",
        "asOf": as_of,
        "fullCoverageSince": full_since,
        "series": series,
        "coverage": {
            "total": len(positions),
            "covered": len(holdings),
            "positionCoverage": (len(holdings) / len(positions) * 100) if positions else 100.0,
            "costCoverage": (covered_cost / total_cost * 100) if total_cost else 100.0,
            "skipped": skipped,
            "assets": assets,
        },
    }


async def sync_portfolio_bars(session: Session, owner_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """回补指定账号持仓的历史日线到 daily_bars（移植 syncPortfolioBars）。

    交易所判定取不到数 → 回退试基金接口（纠正 market 标错）。按 secid 去重。
    """
    if owner_id is None:
        insts = session.execute(
            select(Instrument).join(Position, Position.instrument_id == Instrument.id).distinct()
        ).scalars().all()
    else:
        rows = session.execute(
            scoped_select(Position, owner_id)
            .add_columns(Instrument)
            .join(Instrument, Position.instrument_id == Instrument.id)
        ).all()
        insts = list({inst.id: inst for _, inst in rows}.values())
    results: list[dict[str, Any]] = []
    done: set[str] = set()
    for inst in insts:
        resolved = resolve_bar_secid(inst)
        if resolved is None:
            results.append({"code": inst.display_code, "ok": False, "reason": "unsupported-or-no-secid"})
            continue
        secid, _kind = resolved
        if secid in done:
            results.append({"code": inst.display_code, "secid": secid, "ok": True, "reused": True})
            continue
        result = await ensure_instrument_bars(session, inst, refresh=True)
        if result["ok"]:
            done.update({secid, str(result["secid"])})
        results.append(result)
    session.commit()
    return results


async def ensure_instrument_bars(
    session: Session,
    inst: Instrument,
    *,
    limit: int | None = None,
    refresh: bool = False,
) -> dict[str, Any]:
    """确保单个标的存在可用日线；辩论按需回补，组合同步可强制刷新。"""
    from app.providers.eastmoney import fetch_fund_nav_history, fetch_historical_exchange_bars

    resolved = resolve_bar_secid(inst)
    if resolved is None:
        return {
            "code": inst.display_code,
            "name": inst.name,
            "ok": False,
            "reason": "unsupported-or-no-secid",
        }
    secid, kind = resolved
    if not refresh:
        existing = session.execute(
            select(DailyBar.secid)
            .where(DailyBar.secid == secid, DailyBar.close.is_not(None))
            .limit(1)
        ).first()
        if existing is not None:
            return {
                "code": inst.display_code,
                "name": inst.name,
                "secid": secid,
                "kind": kind,
                "ok": True,
                "reused": True,
            }

    try:
        if kind == "fund":
            bars = await fetch_fund_nav_history(inst.canonical_symbol)
        elif limit is None:
            bars = await fetch_historical_exchange_bars(secid)
        else:
            bars = await fetch_historical_exchange_bars(secid, chunk_size=limit, max_chunks=1)
        if not bars and kind == "exchange" and re.match(r"^\d{6}$", inst.canonical_symbol):
            fund_bars = await fetch_fund_nav_history(inst.canonical_symbol)
            if fund_bars:
                bars, secid, kind = fund_bars, f"OF.{inst.canonical_symbol}", "fund"
    except Exception as exc:  # noqa: BLE001 -- 单一外部数据源失败，调用方按数据缺口降级
        return {
            "code": inst.display_code,
            "name": inst.name,
            "secid": secid,
            "kind": kind,
            "ok": False,
            "reason": f"provider-error:{type(exc).__name__}",
        }
    if not bars:
        return {
            "code": inst.display_code,
            "name": inst.name,
            "secid": secid,
            "kind": kind,
            "ok": False,
            "reason": "no-bars",
        }

    _upsert_bars(session, secid, bars, datetime.now(UTC))
    return {
        "code": inst.display_code,
        "name": inst.name,
        "secid": secid,
        "kind": kind,
        "ok": True,
        "count": len(bars),
    }


def _upsert_bars(session: Session, secid: str, bars: list[dict[str, Any]], now: datetime) -> None:
    values = [
        {
            "secid": secid,
            "date": bar["date"],
            "close": bar.get("close"),
            "volume": bar.get("volume"),
            "updated_at": now,
        }
        for bar in bars
    ]
    if not values:
        return
    statement = insert(DailyBar).values(values)
    statement = statement.on_conflict_do_update(
        index_elements=[DailyBar.secid, DailyBar.date],
        set_={
            "close": statement.excluded.close,
            "volume": statement.excluded.volume,
            "updated_at": statement.excluded.updated_at,
        },
    )
    session.execute(statement)
    session.flush()
