"""M11.1 行情 API 集成测试（方案 §3.4/§14）。

覆盖：鉴权（未登录 401）、指数快照/列表、手动行情覆盖增删（超管 gating + 成员 404）、
批量/单标的行情降级到手动覆盖（不打真实外部接口，靠 quote_overrides 兜底）。
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
from app.models import Log, QuoteOverride, User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"mkt_{uuid.uuid4().hex[:8]}"
    uid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            User(
                id=uid,
                username=username,
                password_hash=hash_password("pass-1234"),
                role=role,
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    return username, uid


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "pass-1234"},
        headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"},
    )
    return client


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


@pytest.fixture
def superadmin():
    name, uid = _mk_user("superadmin")
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_market_endpoints_require_auth():
    client = TestClient(app)
    assert client.get("/api/v1/market/snapshot").status_code == 401
    assert client.get("/api/v1/market/indices").status_code == 401
    assert client.get("/api/v1/search?q=test").status_code == 404
    assert client.get("/api/v1/instruments/search?q=test").status_code == 401


def test_market_snapshot_and_indices(member):
    name, _ = member
    client = _login(name)
    snap = client.get("/api/v1/market/snapshot")
    assert snap.status_code == 200
    assert "indices" in snap.json() and "updatedAt" in snap.json()
    idx = client.get("/api/v1/market/indices")
    assert idx.status_code == 200
    assert isinstance(idx.json()["indices"], list)  # DB market_indices 合并 live


def test_search_requires_q(member):
    name, _ = member
    client = _login(name)
    assert client.get("/api/v1/search").status_code == 404
    assert client.get("/api/v1/instruments/search").status_code == 422  # q 缺失


def test_member_cannot_write_quote_override(member):
    name, _ = member
    client = _login(name)
    # 成员写手动行情 → 404（require_superadmin 不泄露端点）
    resp = client.post("/api/v1/quote-overrides", json={"code": "TEST001", "price": 1.5}, headers=_csrf(client))
    assert resp.status_code == 404


def test_superadmin_quote_override_crud_and_quote_fallback(superadmin, monkeypatch):
    # 屏蔽真实外部行情/搜索（测试只验手动覆盖兜底与鉴权，不打外网）
    async def _no_quote(_secid):
        return None

    async def _no_search(_kw):
        return []

    monkeypatch.setattr("app.services.market.get_stock_quote", _no_quote)
    monkeypatch.setattr("app.services.market.search_stocks", _no_search)

    name, _ = superadmin
    client = _login(name)
    code = f"MANUAL{uuid.uuid4().hex[:6]}"
    # 写覆盖
    resp = client.post(
        "/api/v1/quote-overrides",
        json={"code": code, "name": "手动标的", "market": "基金", "price": 1.234, "changePct": "0.56"},
        headers=_csrf(client),
    )
    assert resp.status_code == 200, resp.text
    quote = resp.json()["quote"]
    assert quote["price"] == 1.234
    assert quote["source"] == "manual"
    assert quote["sourceLabel"] == "手动行情"
    # 单标的行情：外部无实时（非法 code），降级手动覆盖
    single = client.get(f"/api/v1/quote/{code}")
    assert single.status_code == 200
    assert single.json()["price"] == 1.234
    # 批量行情：降级手动覆盖
    batch = client.post("/api/v1/quotes/batch", json={"items": [{"code": code}]}, headers=_csrf(client))
    assert batch.status_code == 200
    assert batch.json()["quotes"][code]["price"] == 1.234
    # 删除
    dele = client.request("DELETE", f"/api/v1/quote-overrides/{code}", headers=_csrf(client))
    assert dele.status_code == 200
    assert dele.json()["deleted"] is True
    # 再删 → false
    dele2 = client.request("DELETE", f"/api/v1/quote-overrides/{code}", headers=_csrf(client))
    assert dele2.json()["deleted"] is False
    # 审计日志写入（增 + 删各一条）
    with SessionLocal() as s:
        logs = s.query(Log).filter(Log.type == "quote_override").all()
        assert any(code in (log.message or "") for log in logs)
        s.execute(delete(Log).where(Log.type == "quote_override", Log.message.like(f"%{code}%")))
        s.execute(delete(QuoteOverride).where(QuoteOverride.code == code))
        s.commit()


def test_quote_not_found_returns_404(superadmin, monkeypatch):
    async def _no_quote(_secid):
        return None

    monkeypatch.setattr("app.services.market.get_stock_quote", _no_quote)
    name, _ = superadmin
    client = _login(name)
    # 无实时、无手动覆盖 → 404
    resp = client.get(f"/api/v1/quote/NOSUCH{uuid.uuid4().hex[:6]}")
    assert resp.status_code == 404
