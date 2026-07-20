"""东方财富 datacenter 宏观 Provider（方案 §6.2 第一优先级，替代 akshare 主路径）。

接口：https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_*
真实数据、带 REPORT_DATE（报告期）。解析纯函数 + fixture 契约测试（§6.3）。

release_at 口径（诚实性铁律 §6.1）：REPORT_DATE 是报告期非发布时间，
用「观测期次月 + 保守滞后」估计 release_at，宁可估晚不用未来数据。
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.providers.macro import (
    MacroObservationDTO,
    MacroSeriesRef,
    MacroSeriesSnapshot,
    filter_by_as_of,
)

_BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_UA = "Mozilla/5.0"

# 指标 → (reportName, 取值字段, 单位, 同比/环比/绝对值, 保守发布滞后天数)
# 滞后：中国官方数据观测月结束后发布，取偏晚估计确保不引入未来数据。
_SPEC: dict[str, dict[str, Any]] = {
    "cpi": {"report": "RPT_ECONOMY_CPI", "field": "NATIONAL_SAME", "unit": "%", "vtype": "yoy", "lag_days": 45},
    "ppi": {"report": "RPT_ECONOMY_PPI", "field": "BASE_SAME", "unit": "%", "vtype": "yoy", "lag_days": 45},
    "pmi": {"report": "RPT_ECONOMY_PMI", "field": "MAKE_INDEX", "unit": "点", "vtype": "absolute", "lag_days": 32},
    "gdp": {"report": "RPT_ECONOMY_GDP", "field": "SUM_SAME", "unit": "%", "vtype": "yoy", "lag_days": 50},
    "m2": {
        "report": "RPT_ECONOMY_CURRENCY_SUPPLY",
        "field": "BASIC_CURRENCY_SAME",
        "unit": "%",
        "vtype": "yoy",
        "lag_days": 50,
    },
}


def _estimate_release_at(report_date: str, lag_days: int) -> datetime | None:
    """由报告期 + 保守滞后估计发布时间（§6.1：宁可估晚，不用未来数据）。"""
    try:
        base = datetime.fromisoformat(report_date.split(" ")[0]).replace(tzinfo=UTC)
    except ValueError:
        return None
    return base + timedelta(days=lag_days)


def _revision_hash(period: str, value: float | None) -> str:
    return hashlib.sha256(f"{period}|{value}".encode()).hexdigest()[:16]


def parse_datacenter(payload: dict[str, Any], spec: dict[str, Any]) -> list[MacroObservationDTO]:
    """解析 datacenter 响应为标准观测（纯函数，fixture 测试）。"""
    rows = (payload.get("result") or {}).get("data") or []
    out: list[MacroObservationDTO] = []
    for row in rows:
        report_date = str(row.get("REPORT_DATE", "")).strip()
        period = str(row.get("TIME", "") or report_date[:7]).strip()
        if not report_date:
            continue
        raw_value = row.get(spec["field"])
        try:
            value: float | None = float(raw_value) if raw_value not in (None, "", "-") else None
        except (ValueError, TypeError):
            value = None
        release_at = _estimate_release_at(report_date, spec["lag_days"])
        out.append(
            MacroObservationDTO(
                observation_period=period,
                release_at=release_at,
                value=value,
                unit=spec["unit"],
                revision_hash=_revision_hash(period, value),
                raw=dict(row),
                data_gap=None if release_at else "报告期解析失败",
            )
        )
    return out


async def _fetch(report_name: str, page_size: int) -> dict[str, Any]:
    url = (
        f"{_BASE}?reportName={report_name}&columns=ALL&pageNumber=1"
        f"&pageSize={page_size}&sortColumns=REPORT_DATE&sortTypes=-1"
    )
    async with httpx.AsyncClient(timeout=12.0, headers={"user-agent": _UA}) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return data


class EastmoneyMacroProvider:
    """实现 MacroDataProvider。东财 datacenter 直连，真实数据。"""

    async def series(self, ref: MacroSeriesRef, as_of: datetime, page_size: int = 24) -> MacroSeriesSnapshot:
        spec = _SPEC.get(ref.code)
        if spec is None:
            return MacroSeriesSnapshot(ref=ref, observations=[], as_of=as_of, data_gap=f"未知指标 {ref.code}")
        try:
            payload = await _fetch(spec["report"], page_size)
        except (httpx.HTTPError, ValueError) as e:
            return MacroSeriesSnapshot(ref=ref, observations=[], as_of=as_of, data_gap=f"东财抓取失败: {e}")
        observations = parse_datacenter(payload, spec)
        filtered = filter_by_as_of(observations, as_of)
        gap = None if filtered else "无 release_at<=as_of 的观测"
        return MacroSeriesSnapshot(ref=ref, observations=filtered, as_of=as_of, data_gap=gap)


# 供辩论证据采集调用：取最近一期已发布值（方案 §7.2 宏观面）
_SUPPORTED = ("cpi", "ppi", "pmi", "gdp", "m2")


async def latest_macro_snapshot(as_of: datetime) -> dict[str, Any]:
    """取各指标最近一期 release_at<=as_of 的值，组装辩论宏观面证据。"""
    provider = EastmoneyMacroProvider()
    result: dict[str, Any] = {}
    gaps: list[str] = []
    for code in _SUPPORTED:
        snap = await provider.series(MacroSeriesRef(source="eastmoney", code=code), as_of)
        if snap.observations:
            # datacenter 返回 REPORT_DATE DESC，过滤后 [0] 是最新已发布期
            latest = snap.observations[0]
            result[code] = {"period": latest.observation_period, "value": latest.value, "unit": latest.unit}
        else:
            gaps.append(code)
    if gaps:
        result["data_gaps"] = gaps
    return result
