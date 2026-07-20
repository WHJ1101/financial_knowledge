"""东方财富基金画像 Provider。

基金和 ETF 没有公司层面的 PE/PB/ROE。本 Provider 从 pingzhongdata
提取规模、资产配置、区间收益和基金经理，用于基金基本面证据。
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import httpx

from app.providers.base import InstrumentRef

_BASE = "https://fund.eastmoney.com/pingzhongdata"
_QUOTE_BASE = "https://push2.eastmoney.com/api/qt/ulist.np/get"
_SEARCH_BASE = "https://searchapi.eastmoney.com/api/suggest/get"
_HEADERS = {"user-agent": "Mozilla/5.0", "referer": "https://fund.eastmoney.com/"}
_TIMEOUT = 8.0


@dataclass(frozen=True)
class FundProfileSnapshot:
    kind: str = "fund_profile"
    name: str = ""
    code: str = ""
    return_1m_pct: float | None = None
    return_3m_pct: float | None = None
    return_6m_pct: float | None = None
    return_1y_pct: float | None = None
    scale_billion: float | None = None
    scale_as_of: str = ""
    scale_change_pct: float | None = None
    stock_ratio_pct: float | None = None
    bond_ratio_pct: float | None = None
    cash_ratio_pct: float | None = None
    allocation_as_of: str = ""
    managers: list[dict[str, Any]] = field(default_factory=list)
    performance_score: float | None = None
    performance_metrics: dict[str, float | None] = field(default_factory=dict)
    top_holdings: list[dict[str, str]] = field(default_factory=list)
    top_holdings_note: str = ""
    source: str = "eastmoney_fund"
    source_url: str = ""
    retrieved_at: datetime | None = None
    data_gap: str | None = None


def _read_js_value(text: str, name: str) -> Any:
    match = re.search(rf"var\s+{re.escape(name)}\s*=\s*([\s\S]*?)\s*;", text or "")
    if not match:
        return None
    try:
        return json.loads(match.group(1).strip())
    except (TypeError, ValueError):
        return None


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _latest_number(values: Any) -> float | None:
    if not isinstance(values, list) or not values:
        return None
    return _number(values[-1])


def _allocation_value(payload: Any, label: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    for item in payload.get("series") or []:
        if isinstance(item, dict) and item.get("name") == label:
            return _latest_number(item.get("data"))
    return None


def _manager_rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        raw_power = item.get("power")
        power: dict[str, Any] = raw_power if isinstance(raw_power, dict) else {}
        rows.append(
            {
                "name": str(item["name"]),
                "star": _number(item.get("star")),
                "work_time": str(item.get("workTime") or ""),
                "managed_size": str(item.get("fundSize") or ""),
                "score": _number(power.get("avr")),
            }
        )
    return rows


def _performance(payload: Any) -> tuple[float | None, dict[str, float | None]]:
    if not isinstance(payload, dict):
        return None, {}
    categories = payload.get("categories") or []
    values = payload.get("data") or []
    metrics = {
        str(label): _number(values[index]) if index < len(values) else None
        for index, label in enumerate(categories)
        if label
    }
    return _number(payload.get("avr")), metrics


def _top_holding_rows(text: str) -> list[dict[str, str]]:
    values = _read_js_value(text, "stockCodesNew")
    if not isinstance(values, list):
        return []
    rows: list[dict[str, str]] = []
    for value in values[:10]:
        secid = str(value or "").strip()
        _, separator, code = secid.partition(".")
        if not separator or not code:
            continue
        rows.append({"secid": secid, "code": code, "name": ""})
    return rows


async def _enrich_holding_names(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if not rows:
        return rows
    params = {"fields": "f12,f14", "secids": ",".join(item["secid"] for item in rows)}
    names: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
        try:
            response = await client.get(_QUOTE_BASE, params=params)
            response.raise_for_status()
            payload = response.json()
            diff = (payload.get("data") or {}).get("diff") if isinstance(payload, dict) else None
            items = diff if isinstance(diff, list) else list(diff.values()) if isinstance(diff, dict) else []
            names.update(
                {
                    str(item.get("f12") or ""): str(item.get("f14") or "")
                    for item in items
                    if isinstance(item, dict) and item.get("f12")
                }
            )
        except (httpx.HTTPError, ValueError):
            pass

        async def search_name(item: dict[str, str]) -> tuple[str, str]:
            if names.get(item["code"]):
                return item["code"], names[item["code"]]
            try:
                response = await client.get(
                    _SEARCH_BASE,
                    params={"input": item["code"], "type": "14", "count": "5"},
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError):
                return item["code"], ""
            data = (payload.get("QuotationCodeTable") or {}).get("Data") if isinstance(payload, dict) else None
            candidates = data if isinstance(data, list) else []
            match = next(
                (
                    candidate
                    for candidate in candidates
                    if isinstance(candidate, dict) and str(candidate.get("QuoteID") or "") == item["secid"]
                ),
                None,
            )
            return item["code"], str(match.get("Name") or "") if match else ""

        searched = await asyncio.gather(*(search_name(item) for item in rows))
        names.update({code: name for code, name in searched if name})
    return [{**item, "name": names.get(item["code"], "")} for item in rows]


def parse_fund_profile(text: str, source_url: str = "") -> FundProfileSnapshot:
    """解析 pingzhongdata 的基金画像字段。"""
    scale = _read_js_value(text, "Data_fluctuationScale")
    scale_series = scale.get("series") if isinstance(scale, dict) else None
    latest_scale = scale_series[-1] if isinstance(scale_series, list) and scale_series else None
    scale_billion = _number(latest_scale.get("y")) if isinstance(latest_scale, dict) else None
    scale_change = None
    if isinstance(latest_scale, dict):
        scale_change = _number(str(latest_scale.get("mom") or "").removesuffix("%"))
    scale_categories = scale.get("categories") if isinstance(scale, dict) else None
    scale_as_of = str(scale_categories[-1]) if isinstance(scale_categories, list) and scale_categories else ""

    allocation = _read_js_value(text, "Data_assetAllocation")
    allocation_categories = allocation.get("categories") if isinstance(allocation, dict) else None
    allocation_as_of = (
        str(allocation_categories[-1])
        if isinstance(allocation_categories, list) and allocation_categories
        else ""
    )
    managers = _manager_rows(_read_js_value(text, "Data_currentFundManager"))
    performance_score, performance_metrics = _performance(
        _read_js_value(text, "Data_performanceEvaluation")
    )
    top_holdings = _top_holding_rows(text)
    return_1m_pct = _number(_read_js_value(text, "syl_1y"))
    return_3m_pct = _number(_read_js_value(text, "syl_3y"))
    return_6m_pct = _number(_read_js_value(text, "syl_6y"))
    return_1y_pct = _number(_read_js_value(text, "syl_1n"))
    stock_ratio = _allocation_value(allocation, "股票占净比")
    bond_ratio = _allocation_value(allocation, "债券占净比")
    cash_ratio = _allocation_value(allocation, "现金占净比")
    has_data = any(
        value is not None
        for value in (
            return_1m_pct,
            return_3m_pct,
            return_6m_pct,
            return_1y_pct,
            scale_billion,
            stock_ratio,
            bond_ratio,
            cash_ratio,
            performance_score,
        )
    ) or bool(managers) or bool(top_holdings)
    return FundProfileSnapshot(
        name=str(_read_js_value(text, "fS_name") or ""),
        code=str(_read_js_value(text, "fS_code") or ""),
        return_1m_pct=return_1m_pct,
        return_3m_pct=return_3m_pct,
        return_6m_pct=return_6m_pct,
        return_1y_pct=return_1y_pct,
        scale_billion=scale_billion,
        scale_as_of=scale_as_of,
        scale_change_pct=scale_change,
        stock_ratio_pct=stock_ratio,
        bond_ratio_pct=bond_ratio,
        cash_ratio_pct=cash_ratio,
        allocation_as_of=allocation_as_of,
        managers=managers,
        performance_score=performance_score,
        performance_metrics=performance_metrics,
        top_holdings=top_holdings,
        top_holdings_note="最新公开十大持仓；数据源未提供单项权重与明确报告期" if top_holdings else "",
        source_url=source_url,
        retrieved_at=datetime.now(UTC),
        data_gap=None if has_data else "基金画像接口无数据",
    )


class EastmoneyFundProvider:
    async def snapshot(self, ref: InstrumentRef) -> FundProfileSnapshot:
        code = ref.canonical_symbol
        source_url = f"{_BASE}/{code}.js"
        if not re.fullmatch(r"\d{6}", code):
            return FundProfileSnapshot(
                code=code,
                source_url=source_url,
                retrieved_at=datetime.now(UTC),
                data_gap="基金代码格式不支持",
            )
        request_url = f"{source_url}?v={int(time.time() * 1000)}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
                response = await client.get(request_url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            return FundProfileSnapshot(
                code=code,
                source_url=source_url,
                retrieved_at=datetime.now(UTC),
                data_gap=f"基金画像抓取失败：{type(exc).__name__}",
            )
        snapshot = parse_fund_profile(response.text, source_url=source_url)
        return replace(snapshot, top_holdings=await _enrich_holding_names(snapshot.top_holdings))
