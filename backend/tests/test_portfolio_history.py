"""M11.7 组合曲线测试（方案 §14）。

纯计算 build_portfolio_series：成分逐日入场、成本基线随 S(t) 收敛、pnlPct 口径。
secid 归类 resolve_bar_secid：基金短路、A股/ETF 号段、港美股 skip。
API：/portfolio/history 按 owner 隔离 + range 校验；sync 限超管。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import DailyBar, Instrument, Position, User, UserSession
from app.services.portfolio_history import Holding, build_portfolio_series, resolve_bar_secid


def _inst(asset_class: str, market: str, symbol: str, provider_ids: dict | None = None) -> Instrument:
    return Instrument(
        id=uuid.uuid4(),
        asset_class=asset_class,
        exchange="SZSE",
        canonical_symbol=symbol,
        display_code=symbol,
        name="x",
        market=market,
        provider_ids=provider_ids or {},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def test_build_series_members_enter_over_time():
    # A 从 d1 有价，B 从 d2 才有价 → d1 只计 A，d2 起计 A+B
    holdings = [Holding("s.A", 100, 10, True), Holding("s.B", 200, 5, True)]
    bars = {
        "s.A": [{"date": "2026-07-01", "close": 10}, {"date": "2026-07-02", "close": 11}],
        "s.B": [{"date": "2026-07-02", "close": 6}],
    }
    series = build_portfolio_series(holdings, bars)
    assert len(series) == 2
    # d1：只有 A 入场
    assert series[0]["coveredCount"] == 1
    assert series[0]["marketValue"] == 100 * 10
    # d2：A+B
    assert series[1]["coveredCount"] == 2
    assert series[1]["marketValue"] == 100 * 11 + 200 * 6
    # pnl: 成本 = 100*10 + 200*5 = 2000, 市值 = 1100+1200=2300 → pnl=300
    assert series[1]["pnl"] == 300
    assert abs(series[1]["pnlPct"] - 15.0) < 1e-9


def test_build_series_forward_fill():
    # A 在 d2 无价 → forward-fill 用 d1 的价
    holdings = [Holding("s.A", 10, 1, True)]
    bars = {"s.A": [{"date": "2026-07-01", "close": 10}, {"date": "2026-07-03", "close": 12}]}
    # d2 不在任何标的的日期并集里，因此序列只有 d1/d3；验证 forward-fill 不重复造日
    series = build_portfolio_series(holdings, bars)
    assert [p["date"] for p in series] == ["2026-07-01", "2026-07-03"]


def test_build_series_empty():
    assert build_portfolio_series([], {}) == []
    assert build_portfolio_series([Holding("s.X", 1, 1, True)], {}) == []


def test_resolve_bar_secid():
    # 场外基金短路
    assert resolve_bar_secid(_inst("open_end_fund", "基金", "014662")) == ("OF.014662", "fund")
    # 创业板 A 股 3 开头 → 0.
    assert resolve_bar_secid(_inst("equity", "创业板", "301308")) == ("0.301308", "exchange")
    # 沪市 6 开头 → 1.
    assert resolve_bar_secid(_inst("equity", "沪市主板", "603986")) == ("1.603986", "exchange")
    # provider_ids 优先
    assert resolve_bar_secid(_inst("equity", "A股", "512480", {"eastmoney": "1.512480"})) == ("1.512480", "exchange")
    # 港股/美股 skip
    assert resolve_bar_secid(_inst("hk_stock", "港股", "00700")) is None
    assert resolve_bar_secid(_inst("us_stock", "美股", "AAPL")) is None


@pytest.fixture
def member_with_position():
    uid = uuid.uuid4()
    username = f"ph_{uuid.uuid4().hex[:8]}"
    code = f"3{uuid.uuid4().int % 100000:05d}"  # 6 位纯数字、3 开头（创业板 → 0.）
    iid = uuid.uuid4()
    secid = f"0.{code}"
    with SessionLocal() as s:
        s.add(
            User(
                id=uid,
                username=username,
                password_hash=hash_password("pass-1234"),
                role="member",
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    with SessionLocal() as s:
        s.add(
            Instrument(
                id=iid,
                asset_class="equity",
                exchange="SZSE",
                canonical_symbol=code,
                display_code=code,
                name="测试",
                market="创业板",
                provider_ids={},
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    with SessionLocal() as s:
        s.add(
            Position(
                id=uuid.uuid4(),
                owner_id=uid,
                instrument_id=iid,
                shares=100,
                cost=10,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        # daily_bars 两日
        s.add(DailyBar(secid=secid, date="2026-07-14", close=10.0, volume=1, updated_at=datetime.now(UTC)))
        s.add(DailyBar(secid=secid, date="2026-07-15", close=11.0, volume=1, updated_at=datetime.now(UTC)))
        s.commit()
    yield username, uid, iid, secid
    with SessionLocal() as s:
        s.execute(delete(Position).where(Position.owner_id == uid))
        s.execute(delete(DailyBar).where(DailyBar.secid == secid))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "pass-1234"},
        headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"},
    )
    return client


def test_portfolio_history_endpoint(member_with_position):
    username, _, _, _ = member_with_position
    client = _login(username)
    resp = client.get("/api/v1/portfolio/history?range=all")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["range"] == "all"
    assert data["coverage"]["covered"] == 1
    assert len(data["series"]) == 2
    assert data["series"][-1]["marketValue"] == 100 * 11.0
    # 非法 range → 400
    assert client.get("/api/v1/portfolio/history?range=bad").status_code == 400


def test_portfolio_history_isolated_by_owner(member_with_position):
    username, _, _, _ = member_with_position
    # 另一个用户看不到 member 的持仓曲线（各自隔离，覆盖数=0）
    other_name = f"ph2_{uuid.uuid4().hex[:8]}"
    other_uid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            User(
                id=other_uid,
                username=other_name,
                password_hash=hash_password("pass-1234"),
                role="member",
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    other = _login(other_name)
    data = other.get("/api/v1/portfolio/history?range=all").json()
    assert data["coverage"]["total"] == 0
    assert data["series"] == []
    with SessionLocal() as s:
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()


def test_portfolio_sync_requires_superadmin(member_with_position):
    username, _, _, _ = member_with_position
    client = _login(username)
    csrf = {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}
    # 成员触发 sync → 404（require_superadmin）
    assert client.post("/api/v1/portfolio/history/sync", headers=csrf).status_code == 404
