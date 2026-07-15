"""压力监控编排（移植 server/services/pressure-monitor.js，方案 M4）。

读 daily_bars → 现算两主题压力快照。THEME_CONFIGS 与原 JS 版一致。
公共数据（无 owner），任何登录用户可读；同步写入限超管（方案 §3.4）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DailyBar
from app.services.pressure import compute_theme_pressure

# 两个固定主题的代理标的与分项定义（MVP：A股 3 分项 / 美股 4 分项）
THEME_CONFIGS: list[dict[str, Any]] = [
    {
        "id": "a-semi",
        "name": "A股半导体",
        "market": "A股",
        "volumeKey": "vr",
        "subs": [
            {"key": "vr", "label": "量比", "kind": "volumeRatio", "secid": "1.512480"},
            {"key": "def", "label": "半导体 vs 红利", "kind": "underperformance",
             "sector": "1.512480", "baseline": "1.510880"},
            {"key": "broad", "label": "沪深300 vs 半导体", "kind": "underperformance",
             "sector": "1.512480", "baseline": "1.000300"},
        ],
    },
    {
        "id": "us-semi",
        "name": "美股半导体",
        "market": "美股",
        "volumeKey": "vr",
        "subs": [
            {"key": "vr", "label": "SOXX 量比", "kind": "volumeRatio", "secid": "105.SOXX"},
            {"key": "def", "label": "SOXX vs XLU", "kind": "underperformance",
             "sector": "105.SOXX", "baseline": "107.XLU"},
            {"key": "broad", "label": "SPY vs SOXX", "kind": "underperformance",
             "sector": "105.SOXX", "baseline": "107.SPY"},
            {"key": "vix", "label": "VIX − VIX3M", "kind": "spread",
             "high": "YAHOO.VIX", "low": "YAHOO.VIX3M"},
        ],
    },
]


def _all_secids() -> list[str]:
    secids: set[str] = set()
    for theme in THEME_CONFIGS:
        for sub in theme["subs"]:
            for key in ("secid", "sector", "baseline", "high", "low"):
                if sub.get(key):
                    secids.add(sub[key])
    return sorted(secids)


def _theme_secids(config: dict[str, Any]) -> list[str]:
    secids: set[str] = set()
    for sub in config["subs"]:
        for key in ("secid", "sector", "baseline", "high", "low"):
            if sub.get(key):
                secids.add(sub[key])
    return sorted(secids)


def _load_bars(session: Session, secids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """从 daily_bars 读各 secid 的日线（按日期升序）。"""
    result: dict[str, list[dict[str, Any]]] = {}
    for secid in secids:
        rows = session.execute(
            select(DailyBar).where(DailyBar.secid == secid).order_by(DailyBar.date)
        ).scalars().all()
        result[secid] = [{"date": r.date, "close": r.close, "volume": r.volume} for r in rows]
    return result


def get_pressure_snapshot(session: Session) -> list[dict[str, Any]]:
    """现算所有主题的压力快照（供 /api/v1/pressure）。"""
    bars = _load_bars(session, _all_secids())
    return [
        {
            "id": config["id"],
            "name": config["name"],
            "market": config["market"],
            "secids": _theme_secids(config),
            **compute_theme_pressure(bars, config),
        }
        for config in THEME_CONFIGS
    ]
