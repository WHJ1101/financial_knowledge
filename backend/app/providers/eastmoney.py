"""东财行情/K线/基本面 Provider（移植 market-data.js + kline-store.js，方案 §6.2）。

解析逻辑抽成纯函数（parse_*），可用保存的真实响应 fixture 契约测试（§6.3），
不打真实接口。HTTP 抓取用 httpx.AsyncClient + 重试。
PE/PB 需 /100（辩论文档附录 A）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from app.providers.base import Bar, FundamentalSnapshot, InstrumentRef, QuoteSnapshot

_UA = "Mozilla/5.0"
_TIMEOUT = 8.0
_MAX_ATTEMPTS = 3

# 东财基本面字段（辩论文档附录 A）
_F_PE, _F_PB, _F_MKTCAP, _F_ROE, _F_REV_YOY, _F_PROFIT_YOY = "f162", "f167", "f116", "f173", "f184", "f185"


def eastmoney_secid(ref: InstrumentRef) -> str:
    """由证券身份构造东财 secid。优先用 provider_ids.eastmoney，否则按交易所推断。"""
    if ref.provider_ids.get("eastmoney"):
        return ref.provider_ids["eastmoney"]
    prefix = {"SSE": "1", "SZSE": "0"}.get(ref.exchange)
    if prefix:
        return f"{prefix}.{ref.canonical_symbol}"
    # 场外基金用 OF. 前缀（东财基金接口）
    if ref.asset_class == "open_end_fund":
        return f"OF.{ref.canonical_symbol}"
    return ref.canonical_symbol


# ---- 纯解析函数（fixture 契约测试，§6.3）----


def parse_kline(payload: dict[str, Any]) -> list[Bar]:
    """东财 kline：fields2=f51,f53,f56 即 date,close,volume。data=null → []。"""
    klines = (payload.get("data") or {}).get("klines")
    if not isinstance(klines, list):
        return []
    bars: list[Bar] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 3:
            continue
        date, close, volume = parts[0], parts[1], parts[2]
        try:
            close_num = float(close)
        except (ValueError, TypeError):
            continue
        try:
            volume_num: float | None = float(volume)
        except (ValueError, TypeError):
            volume_num = None
        if not date:
            continue
        bars.append(Bar(date=date, close=close_num, volume=volume_num))
    return bars


def _f(data: dict[str, Any], key: str, scale: float = 1.0) -> float | None:
    v = data.get(key)
    if v is None or v == "-":
        return None
    try:
        return float(v) / scale
    except (ValueError, TypeError):
        return None


def parse_fundamentals(payload: dict[str, Any], source_url: str = "") -> FundamentalSnapshot:
    """东财 push2 stock/get 估值快照。PE/PB /100（辩论文档附录 A 量纲）。"""
    data = payload.get("data")
    now = datetime.now(UTC)
    if not data:
        return FundamentalSnapshot(source_url=source_url, retrieved_at=now, data_gap="估值接口无数据")
    return FundamentalSnapshot(
        pe=_f(data, _F_PE, 100),
        pb=_f(data, _F_PB, 100),
        roe=_f(data, _F_ROE),
        revenue_yoy=_f(data, _F_REV_YOY),
        profit_yoy=_f(data, _F_PROFIT_YOY),
        market_cap=_f(data, _F_MKTCAP),
        source="eastmoney",
        source_url=source_url,
        retrieved_at=now,
    )


def parse_quote(payload: dict[str, Any], source_url: str = "") -> QuoteSnapshot:
    """东财 push2 stock/get 行情快照（f43 现价 /100, f170 涨跌幅 /100, f58 名称）。"""
    data = payload.get("data")
    now = datetime.now(UTC)
    if not data:
        return QuoteSnapshot(name="", price=None, change_pct=None, source="eastmoney",
                             source_url=source_url, retrieved_at=now, data_gap="行情接口无数据")
    price = _f(data, "f43", 100)
    change = _f(data, "f170", 100)
    return QuoteSnapshot(
        name=str(data.get("f58") or ""),
        price=price,
        change_pct=f"{change:.2f}" if change is not None else None,
        source="eastmoney", source_url=source_url, retrieved_at=now,
        raw={"f43": data.get("f43"), "f170": data.get("f170")},
    )


# ---- HTTP 抓取（带重试；真实网络，普通测试不调用）----


async def _get_json(url: str) -> dict[str, Any]:
    last_err: Exception | None = None
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"user-agent": _UA}) as client:
        for _attempt in range(_MAX_ATTEMPTS):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data: dict[str, Any] = resp.json()
                return data
            except (httpx.HTTPError, ValueError) as err:
                last_err = err
    raise RuntimeError(f"抓取失败: {url}") from last_err


class EastmoneyProvider:
    """行情 + K线 + 基本面。实现 MarketDataProvider / FundamentalDataProvider。"""

    async def bars(self, ref: InstrumentRef, limit: int = 250) -> list[Bar]:
        secid = eastmoney_secid(ref)
        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}"
            f"&klt=101&fqt=1&fields1=f1,f2&fields2=f51,f53,f56&beg=0&end=20500101&lmt={limit}"
        )
        return parse_kline(await _get_json(url))

    async def quote(self, ref: InstrumentRef) -> QuoteSnapshot:
        secid = eastmoney_secid(ref)
        url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f43,f58,f170"
        return parse_quote(await _get_json(url), source_url=url)

    async def snapshot(self, ref: InstrumentRef) -> FundamentalSnapshot:
        secid = eastmoney_secid(ref)
        fields = f"{_F_PE},{_F_PB},{_F_MKTCAP},{_F_ROE},{_F_REV_YOY},{_F_PROFIT_YOY},f57,f58"
        url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields={fields}"
        return parse_fundamentals(await _get_json(url), source_url=url)
