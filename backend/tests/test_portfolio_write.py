"""M4 写 API 测试（方案 §14）：CRUD + 属主校验 + 报告个人态。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import Instrument, Position, Report, User, UserReportState, UserSession, WatchlistItem


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"m4_{uuid.uuid4().hex[:8]}"
    uid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(User(id=uid, username=username, password_hash=hash_password("pass-1234"),
                   role=role, status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
    return username, uid


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post("/api/v1/auth/login", json={"username": username, "password": "pass-1234"},
                headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"})
    return client


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(Position).where(Position.owner_id == uid))
        s.execute(delete(WatchlistItem).where(WatchlistItem.owner_id == uid))
        s.execute(delete(UserReportState).where(UserReportState.user_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_add_position_creates_instrument(member):
    name, _ = member
    client = _login(name)
    sym = uuid.uuid4().hex[:6]
    resp = client.post("/api/v1/positions",
                       json={"code": f"SZ{sym}", "name": "测试", "market": "创业板", "shares": 100, "cost": 10},
                       headers=_csrf(client))
    assert resp.status_code == 200, resp.text
    pos_id = resp.json()["id"]
    assert len(client.get("/api/v1/positions").json()) == 1
    # 更新
    upd = client.patch(f"/api/v1/positions/{pos_id}", json={"shares": 200, "cost": 12}, headers=_csrf(client))
    assert upd.status_code == 200
    assert upd.json()["shares"] == 200
    # 删除
    dele = client.request("DELETE", f"/api/v1/positions/{pos_id}", headers=_csrf(client))
    assert dele.status_code == 200
    assert len(client.get("/api/v1/positions").json()) == 0
    with SessionLocal() as s:
        s.execute(delete(Instrument).where(Instrument.canonical_symbol == sym))
        s.commit()


def test_cannot_delete_others_position(member):
    name, _ = member
    other_name, other_uid = _mk_user()
    client = _login(name)
    other = _login(other_name)
    sym = uuid.uuid4().hex[:6]
    pos_id = other.post("/api/v1/positions",
                        json={"code": f"SZ{sym}", "name": "他人", "market": "创业板", "shares": 1, "cost": 1},
                        headers=_csrf(other)).json()["id"]
    # 本人删他人持仓 → 404
    resp = client.request("DELETE", f"/api/v1/positions/{pos_id}", headers=_csrf(client))
    assert resp.status_code == 404
    with SessionLocal() as s:
        s.execute(delete(Position).where(Position.owner_id == other_uid))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.execute(delete(Instrument).where(Instrument.canonical_symbol == sym))
        s.commit()


def test_report_star_read_personal_state(member):
    name, uid = member
    client = _login(name)
    rid = f"m4rep_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        s.add(Report(id=rid, owner_id=uid, visibility="private", title="t", topic="t", type="custom",
                     created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
    assert client.post(f"/api/v1/reports/{rid}/star", headers=_csrf(client)).status_code == 200
    assert client.post(f"/api/v1/reports/{rid}/read", headers=_csrf(client)).status_code == 200
    view = client.get(f"/api/v1/reports/{rid}").json()
    assert view["starred"] is True
    assert view["read"] is True
    with SessionLocal() as s:
        s.execute(delete(UserReportState).where(UserReportState.report_id == rid))
        s.execute(delete(Report).where(Report.id == rid))
        s.commit()


def test_member_cannot_publish(member):
    name, uid = member
    client = _login(name)
    rid = f"m4pub_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        s.add(Report(id=rid, owner_id=uid, visibility="private", title="t", topic="t", type="custom",
                     created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
    # 成员 publish → 404（require_superadmin）
    assert client.post(f"/api/v1/reports/{rid}/publish", headers=_csrf(client)).status_code == 404
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.id == rid))
        s.commit()
