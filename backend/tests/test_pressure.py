"""压力指数纯函数测试（对齐原 lib/pressure-index.test.js 语义）。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import delete

from app.db import SessionLocal
from app.models import CommunitySignal, DailyBar, Log, Setting
from app.services.pressure import (
    build_status,
    compute_theme_pressure,
    detect_crossing,
    percentile_rank,
)


def test_percentile_rank():
    assert percentile_rank([1, 2, 3, 4], 3) == 75.0
    assert percentile_rank([], 5) is None
    assert percentile_rank([5], 5) == 100.0


def test_detect_crossing_up():
    series = [{"date": "d1", "composite": 65}, {"date": "d2", "composite": 72}]
    assert detect_crossing(series) == "up-70"


def test_detect_crossing_down():
    series = [{"date": "d1", "composite": 35}, {"date": "d2", "composite": 28}]
    assert detect_crossing(series) == "down-30"


def test_detect_crossing_none():
    series = [{"date": "d1", "composite": 50}, {"date": "d2", "composite": 55}]
    assert detect_crossing(series) is None


def test_build_status_quadrants():
    up = [{"date": "d1", "composite": 50}, {"date": "d2", "composite": 60}]
    assert build_status(up, 60) == "放量下跌，压力抬升中"
    assert build_status(up, 30) == "缩量阴跌"
    down = [{"date": "d1", "composite": 60}, {"date": "d2", "composite": 50}]
    assert build_status(down, 30) == "低量企稳，压力回落"
    assert build_status(down, 60) == "放量反弹待确认"
    assert build_status([], None) == "数据不足"


def test_compute_empty_config():
    result = compute_theme_pressure({}, {"subs": []})
    assert result["status"] == "数据不足"
    assert result["composite"] is None


def test_compute_volume_ratio_no_nan():
    # 造 25 天日线，量比分项应能算出且无 None 崩溃
    bars = {"1.X": [{"date": f"2026-01-{i:02d}", "close": 100 + i, "volume": 1000 + i * 10} for i in range(1, 26)]}
    config = {"volumeKey": "vr", "subs": [{"key": "vr", "label": "量比", "kind": "volumeRatio", "secid": "1.X"}]}
    result = compute_theme_pressure(bars, config)
    assert result["composite"] is not None
    assert result["subScores"][0]["score"] is not None


def test_pressure_monitor_persists_bars_crossing_and_summary(monkeypatch):
    async def fake_fetch(secid: str):
        return [{"date": "2026-07-16", "close": 100, "volume": 1000}]

    async def fake_notify(_session, _themes):
        return {"ok": True, "count": 1}

    theme = {
        "id": "test-theme",
        "name": "测试主题",
        "market": "A股",
        "secids": ["1.TEST"],
        "date": "2026-07-16",
        "composite": 75.0,
        "crossing": "up-70",
        "status": "压力抬升中",
        "subScores": [{"label": "量比", "score": 80, "rawText": "1.5x"}],
    }
    monkeypatch.setattr("app.services.pressure_monitor._all_secids", lambda: ["1.TEST"])
    monkeypatch.setattr("app.services.pressure_monitor._fetch_pressure_bars", fake_fetch)
    monkeypatch.setattr("app.services.pressure_monitor.get_pressure_snapshot", lambda _session: [theme])
    monkeypatch.setattr("app.services.notification_delivery.deliver_pressure_crossings", fake_notify)

    from app.services.pressure_monitor import run_pressure_monitor

    signal_id = f"pressure-test-theme-{datetime.now(UTC).astimezone(ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d')}"
    with SessionLocal() as session:
        result = asyncio.run(run_pressure_monitor(session))
        assert result["signalsWritten"] == 1
        assert session.get(DailyBar, ("1.TEST", "2026-07-16")) is not None
        assert session.get(CommunitySignal, signal_id) is not None
        assert session.get(Setting, "lastPressureRun").value["signalsWritten"] == 1
        session.execute(delete(Log).where(Log.type == "pressure_monitor"))
        session.execute(delete(CommunitySignal).where(CommunitySignal.id == signal_id))
        session.execute(delete(DailyBar).where(DailyBar.secid == "1.TEST"))
        session.execute(delete(Setting).where(Setting.key == "lastPressureRun"))
        session.commit()
