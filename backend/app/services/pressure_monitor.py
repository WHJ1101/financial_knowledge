"""压力监控编排（移植 server/services/pressure-monitor.js，方案 M4）。

读 daily_bars → 现算两主题压力快照。THEME_CONFIGS 与原 JS 版一致。
公共数据（无 owner），任何登录用户可读；同步写入限超管（方案 §3.4）。
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import CommunitySignal, DailyBar, Setting
from app.services.logs import append_log
from app.services.pressure import LOWER_THRESHOLD, UPPER_THRESHOLD, compute_theme_pressure

# 两个固定主题的代理标的与分项定义（MVP：A股 3 分项 / 美股 4 分项）
THEME_CONFIGS: list[dict[str, Any]] = [
    {
        "id": "a-semi",
        "name": "A股半导体",
        "market": "A股",
        "volumeKey": "vr",
        "subs": [
            {"key": "vr", "label": "量比", "kind": "volumeRatio", "secid": "1.512480"},
            {
                "key": "def",
                "label": "半导体 vs 红利",
                "kind": "underperformance",
                "sector": "1.512480",
                "baseline": "1.510880",
            },
            {
                "key": "broad",
                "label": "沪深300 vs 半导体",
                "kind": "underperformance",
                "sector": "1.512480",
                "baseline": "1.000300",
            },
        ],
    },
    {
        "id": "us-semi",
        "name": "美股半导体",
        "market": "美股",
        "volumeKey": "vr",
        "subs": [
            {"key": "vr", "label": "SOXX 量比", "kind": "volumeRatio", "secid": "105.SOXX"},
            {
                "key": "def",
                "label": "SOXX vs XLU",
                "kind": "underperformance",
                "sector": "105.SOXX",
                "baseline": "107.XLU",
            },
            {
                "key": "broad",
                "label": "SPY vs SOXX",
                "kind": "underperformance",
                "sector": "105.SOXX",
                "baseline": "107.SPY",
            },
            {"key": "vix", "label": "VIX − VIX3M", "kind": "spread", "high": "YAHOO.VIX", "low": "YAHOO.VIX3M"},
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
        rows = session.execute(select(DailyBar).where(DailyBar.secid == secid).order_by(DailyBar.date)).scalars().all()
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


async def _fetch_yahoo_bars(secid: str, limit: int = 250) -> list[dict[str, Any]]:
    symbols = {"YAHOO.VIX": "^VIX", "YAHOO.VIX3M": "^VIX3M"}
    symbol = symbols.get(secid, secid.removeprefix("YAHOO."))
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    async with httpx.AsyncClient(timeout=8, headers={"user-agent": "Mozilla/5.0"}) as client:
        response = await client.get(url, params={"interval": "1d", "range": "1y"})
        response.raise_for_status()
        payload = response.json()
    result = ((payload.get("chart") or {}).get("result") or [None])[0] or {}
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    bars: list[dict[str, Any]] = []
    for timestamp, close in zip(timestamps, closes, strict=False):
        if close is None:
            continue
        bars.append(
            {
                "date": datetime.fromtimestamp(float(timestamp), UTC).strftime("%Y-%m-%d"),
                "close": float(close),
                "volume": None,
            }
        )
    return bars[-limit:]


async def _fetch_pressure_bars(secid: str) -> list[dict[str, Any]]:
    if secid.startswith("YAHOO."):
        return await _fetch_yahoo_bars(secid)
    from app.providers.eastmoney import fetch_historical_exchange_bars

    return await fetch_historical_exchange_bars(secid, chunk_size=250, max_chunks=1)


async def sync_pressure_bars(session: Session) -> list[dict[str, Any]]:
    """并发回补压力监控所需的 250 日日线；单数据源失败不阻断其余。"""
    secids = _all_secids()

    async def fetch_one(secid: str) -> tuple[str, list[dict[str, Any]] | None, str | None]:
        try:
            return secid, await _fetch_pressure_bars(secid), None
        except Exception as exc:  # noqa: BLE001 -- 每个行情源独立降级
            return secid, None, f"{type(exc).__name__}: {str(exc)[:120]}"

    fetched = await asyncio.gather(*(fetch_one(secid) for secid in secids))
    now = datetime.now(UTC)
    results: list[dict[str, Any]] = []
    for secid, bars, error in fetched:
        if bars is None:
            results.append({"secid": secid, "ok": False, "count": 0, "error": error})
            continue
        for bar in bars:
            row = session.get(DailyBar, (secid, bar["date"]))
            if row is None:
                row = DailyBar(secid=secid, date=bar["date"])
                session.add(row)
            row.close = bar.get("close")
            row.volume = bar.get("volume")
            row.updated_at = now
        results.append({"secid": secid, "ok": True, "count": len(bars)})
    session.flush()
    return results


def _crossing_signal(theme: dict[str, Any], now: datetime) -> CommunitySignal:
    is_up = theme.get("crossing") == "up-70"
    threshold = UPPER_THRESHOLD if is_up else LOWER_THRESHOLD
    arrow = "上穿" if is_up else "下穿"
    date = now.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    sub_scores = theme.get("subScores") or []
    evidence = "主导分项：" + "；".join(
        f"{item.get('label')} {item.get('score', '-')}（{item.get('rawText', '-')}）" for item in sub_scores
    )
    summary = f"{theme['name']}压力指数{arrow} {threshold}（{theme.get('composite')}），{theme.get('status', '')}"
    content_fingerprint = hashlib.sha256(f"{summary}|{evidence}".encode()).hexdigest()
    return CommunitySignal(
        id=f"pressure-{theme['id']}-{date}",
        date=date,
        source="pressure-monitor",
        source_title="板块压力监控",
        source_url=None,
        theme=theme["name"],
        industry=theme.get("market"),
        related_assets=theme.get("secids") or [],
        signal_type="压力上穿" if is_up else "压力下穿",
        summary=summary,
        evidence=evidence,
        confidence="medium",
        verification_status="待验证",
        importance=5 if is_up else 4,
        observed_at=now.isoformat(),
        imported_at=now.isoformat(),
        expires_at=None,
        signal_metadata={"composite": theme.get("composite"), "crossing": theme.get("crossing")},
        section_key=f"pressure-monitor:{theme['id']}:{date}",
        content_fingerprint=content_fingerprint,
        version_no=1,
        active=True,
        created_at=now,
        updated_at=now,
    )


async def run_pressure_monitor(session: Session, source: str = "manual") -> dict[str, Any]:
    """拉日线、计算压力、写跨阈值信号/运行摘要，并发送飞书告警。"""
    sync_results = await sync_pressure_bars(session)
    themes = get_pressure_snapshot(session)
    now = datetime.now(UTC)
    crossings = [theme for theme in themes if theme.get("crossing")]
    if crossings:
        date = now.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
        session.execute(
            delete(CommunitySignal).where(
                CommunitySignal.source == "pressure-monitor",
                CommunitySignal.date == date,
                CommunitySignal.source_title == "板块压力监控",
            )
        )
        session.add_all([_crossing_signal(theme, now) for theme in crossings])

    from app.services.notification_delivery import deliver_pressure_crossings

    push_result = await deliver_pressure_crossings(session, themes)
    summary = {
        "ranAt": now.isoformat(),
        "themes": [
            {
                "id": theme["id"],
                "composite": theme.get("composite"),
                "crossing": theme.get("crossing"),
                "status": theme.get("status"),
            }
            for theme in themes
        ],
        "signalsWritten": len(crossings),
        "feishuPush": push_result,
        "syncFailures": [
            {"secid": item["secid"], "error": item.get("error")} for item in sync_results if not item["ok"]
        ],
    }
    setting = session.get(Setting, "lastPressureRun")
    if setting is None:
        session.add(Setting(key="lastPressureRun", value=summary))
    else:
        setting.value = summary
    append_log(
        session,
        "pressure_monitor",
        f"Pressure monitor ran ({len(crossings)} signals)",
        {"source": source, **summary},
    )
    session.commit()
    return {**summary, "syncResults": sync_results}
