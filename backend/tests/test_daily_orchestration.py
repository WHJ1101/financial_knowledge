"""完整日更编排：只读取执行超管私有持仓，并串起所有附属步骤。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import delete

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Instrument, Log, Position, Setting, User
from app.services.automation import run_daily_job


def test_daily_job_uses_only_execution_owner_positions(monkeypatch) -> None:
    admin_id = uuid.uuid4()
    member_id = uuid.uuid4()
    admin_instrument = uuid.uuid4()
    member_instrument = uuid.uuid4()
    now = datetime.now(UTC)
    with SessionLocal() as session:
        session.add_all(
            [
                User(
                    id=admin_id,
                    username=f"job_{uuid.uuid4().hex[:8]}",
                    password_hash=hash_password("pass-1234"),
                    role="superadmin",
                    status="active",
                    created_at=now,
                    updated_at=now,
                ),
                User(
                    id=member_id,
                    username=f"job_{uuid.uuid4().hex[:8]}",
                    password_hash=hash_password("pass-1234"),
                    role="member",
                    status="active",
                    created_at=now,
                    updated_at=now,
                ),
                Instrument(
                    id=admin_instrument,
                    asset_class="equity",
                    exchange="SSE",
                    canonical_symbol=uuid.uuid4().hex[:6],
                    display_code="ADMIN_ONLY",
                    name="本人持仓",
                    market="A股",
                    provider_ids={},
                    source="test",
                    active=True,
                    created_at=now,
                    updated_at=now,
                ),
                Instrument(
                    id=member_instrument,
                    asset_class="equity",
                    exchange="SZSE",
                    canonical_symbol=uuid.uuid4().hex[:6],
                    display_code="MEMBER_PRIVATE",
                    name="他人私有持仓",
                    market="A股",
                    provider_ids={},
                    source="test",
                    active=True,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                Position(
                    id=uuid.uuid4(),
                    owner_id=admin_id,
                    instrument_id=admin_instrument,
                    shares=10,
                    cost=20,
                    created_at=now,
                    updated_at=now,
                ),
                Position(
                    id=uuid.uuid4(),
                    owner_id=member_id,
                    instrument_id=member_instrument,
                    shares=99,
                    cost=88,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        session.commit()

    captured: dict[str, object] = {}

    async def fake_signal_sync(*_args):
        return {"ok": True, "skipped": False, "written": 0, "processed_dates": []}

    async def fake_brief(_now, positions, signals, **_kwargs):
        captured["positions"] = positions
        captured["signals"] = signals
        return {"window": SimpleNamespace(end=now), "dataQuality": [], "summary": "ok"}

    async def fake_pressure(*_args, **_kwargs):
        return {"syncFailures": []}

    async def fake_portfolio(_session, owner_id):
        captured["portfolio_owner"] = owner_id
        return []

    async def fake_notify(_themes):
        return {"skipped": True}

    monkeypatch.setattr("app.services.signal_sync.sync_feishu_signals_async", fake_signal_sync)
    monkeypatch.setattr(
        "app.services.signal_sync.top_community_signals", lambda *_args, **_kwargs: [{"theme": "公共信号"}]
    )
    monkeypatch.setattr("app.services.daily_briefing.run_daily_briefing", fake_brief)
    monkeypatch.setattr(
        "app.services.report_lifecycle.create_daily_briefing_report",
        lambda *_args, **_kwargs: SimpleNamespace(id="daily-test", title="测试日更", type="market", summary="ok"),
    )
    monkeypatch.setattr("app.services.pressure_monitor.run_pressure_monitor", fake_pressure)
    monkeypatch.setattr("app.services.pressure_monitor.get_pressure_snapshot", lambda *_args: [])
    monkeypatch.setattr("app.services.portfolio_history.sync_portfolio_bars", fake_portfolio)
    monkeypatch.setattr("app.providers.feishu.notify_daily_briefing", fake_notify)

    with SessionLocal() as session:
        admin = session.get(User, admin_id)
        assert admin is not None
        result = asyncio.run(run_daily_job(session, admin, source="daily"))

    assert result["skipped"] is False
    assert [item["code"] for item in captured["positions"]] == ["ADMIN_ONLY"]
    assert captured["signals"] == [{"theme": "公共信号"}]
    assert captured["portfolio_owner"] == admin_id

    with SessionLocal() as session:
        session.execute(delete(Log).where(Log.type == "daily_job"))
        session.execute(
            delete(Setting).where(
                Setting.key.in_(
                    [
                        "lastDailyRun",
                        "lastDailyBriefingRunAt",
                        "lastDailyBriefingWindowEnd",
                        "lastDailyBriefingSourceStats",
                        "lastCommunitySignalSync",
                    ]
                )
            )
        )
        session.execute(delete(Position).where(Position.owner_id.in_([admin_id, member_id])))
        session.execute(delete(Instrument).where(Instrument.id.in_([admin_instrument, member_instrument])))
        session.execute(delete(User).where(User.id.in_([admin_id, member_id])))
        session.commit()
