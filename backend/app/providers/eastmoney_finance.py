"""东方财富财务数据备用 Provider。

主行情域名偶发主动断连时，使用独立 datacenter 主机补充 ROE、营收同比和净利同比。
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.providers.base import FundamentalSnapshot, InstrumentRef

_BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_HEADERS = {"user-agent": "Mozilla/5.0", "referer": "https://data.eastmoney.com/"}
_TIMEOUT = 10.0
_MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class EquityFundamentalSnapshot(FundamentalSnapshot):
    kind: str = "equity_fundamental"
    report_period: str = ""
    release_at: str = ""
    source: str = "eastmoney_datacenter"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def parse_finance_snapshot(payload: dict[str, Any], source_url: str = "") -> EquityFundamentalSnapshot:
    rows = (payload.get("result") or {}).get("data") or []
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    now = datetime.now(UTC)
    if row is None:
        return EquityFundamentalSnapshot(
            source_url=source_url,
            retrieved_at=now,
            data_gap="财务数据接口无数据",
        )
    roe = _number(row.get("ROEJQ"))
    revenue_yoy = _number(row.get("TOTALOPERATEREVETZ"))
    profit_yoy = _number(row.get("PARENTNETPROFITTZ"))
    has_data = any(value is not None for value in (roe, revenue_yoy, profit_yoy))
    return EquityFundamentalSnapshot(
        roe=roe,
        revenue_yoy=revenue_yoy,
        profit_yoy=profit_yoy,
        source_url=source_url,
        retrieved_at=now,
        report_period=str(row.get("REPORT_DATE_NAME") or row.get("REPORT_DATE") or ""),
        release_at=str(row.get("NOTICE_DATE") or ""),
        data_gap=None if has_data else "财务数据接口无有效指标",
    )


def _security_code(ref: InstrumentRef) -> str | None:
    suffix = {"SSE": "SH", "SZSE": "SZ"}.get(ref.exchange)
    if suffix is None:
        return None
    return f"{ref.canonical_symbol}.{suffix}"


class EastmoneyFinanceProvider:
    async def snapshot(self, ref: InstrumentRef) -> EquityFundamentalSnapshot:
        security_code = _security_code(ref)
        if security_code is None:
            return EquityFundamentalSnapshot(
                retrieved_at=datetime.now(UTC),
                data_gap=f"财务备用源不支持交易所 {ref.exchange}",
            )
        params = {
            "reportName": "RPT_F10_FINANCE_MAINFINADATA",
            "columns": "ALL",
            "filter": f'(SECUCODE="{security_code}")',
            "pageNumber": "1",
            "pageSize": "1",
            "sortColumns": "REPORT_DATE",
            "sortTypes": "-1",
        }
        source_url = str(httpx.URL(_BASE, params=params))
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            for attempt in range(_MAX_ATTEMPTS):
                try:
                    response = await client.get(_BASE, params=params)
                    response.raise_for_status()
                    payload: dict[str, Any] = response.json()
                    return parse_finance_snapshot(payload, source_url=source_url)
                except (httpx.HTTPError, ValueError) as exc:
                    last_error = exc
                    if attempt + 1 < _MAX_ATTEMPTS:
                        await asyncio.sleep(0.2 * (attempt + 1))
        return EquityFundamentalSnapshot(
            source_url=source_url,
            retrieved_at=datetime.now(UTC),
            data_gap=f"财务备用源抓取失败：{type(last_error).__name__ if last_error else 'UnknownError'}",
        )
