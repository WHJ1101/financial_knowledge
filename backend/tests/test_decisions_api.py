"""决策 API 测试（方案 §7.7）：创建校验、去重、未配 key、属主隔离。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.crypto import encrypt_api_key
from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import (
    Debate,
    Instrument,
    Position,
    User,
    UserLlmConfig,
    UserSession,
)


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post("/api/v1/auth/login", json={"username": username, "password": "pass-1234"},
                headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"})
    return client


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


@pytest.fixture
def user_with_position():
    uid = uuid.uuid4()
    username = f"dec_{uuid.uuid4().hex[:8]}"
    sym = uuid.uuid4().hex[:6]
    with SessionLocal() as s:
        s.add(User(id=uid, username=username, password_hash=hash_password("pass-1234"),
                   role="member", status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        inst = Instrument(id=uuid.uuid4(), asset_class="equity", exchange="SZSE", canonical_symbol=sym,
                          display_code=f"SZ{sym}", name="测试", market="创业板", provider_ids={},
                          created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
        s.add(inst)
        s.flush()
        s.add(Position(id=uuid.uuid4(), owner_id=uid, instrument_id=inst.id, shares=1, cost=1,
                       created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
        inst_id = inst.id
    yield username, uid, inst_id
    with SessionLocal() as s:
        s.execute(delete(Debate).where(Debate.owner_id == uid))
        s.execute(delete(Position).where(Position.owner_id == uid))
        s.execute(delete(UserLlmConfig).where(UserLlmConfig.user_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.execute(delete(Instrument).where(Instrument.id == inst_id))
        s.commit()


def test_create_debate_without_byok_422(user_with_position):
    username, _, inst_id = user_with_position
    client = _login(username)
    resp = client.post("/api/v1/debates", json={"instrument_id": str(inst_id), "horizon": "swing"},
                       headers=_csrf(client))
    assert resp.status_code == 422  # llm_unavailable（未配 BYOK）


def _set_byok(uid: uuid.UUID) -> None:
    with SessionLocal() as s:
        s.add(UserLlmConfig(user_id=uid, api_key_ciphertext=encrypt_api_key("sk-x"),
                            api_url="https://openrouter.ai/api/v1", model="m", key_version=1))
        s.commit()


def test_create_debate_success_and_dedup(user_with_position):
    username, uid, inst_id = user_with_position
    _set_byok(uid)
    client = _login(username)
    resp = client.post("/api/v1/debates", json={"instrument_id": str(inst_id), "horizon": "swing"},
                       headers=_csrf(client))
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "queued"
    # 去重：同标的再发 → 409
    resp2 = client.post("/api/v1/debates", json={"instrument_id": str(inst_id), "horizon": "swing"},
                        headers=_csrf(client))
    assert resp2.status_code == 409


def test_instrument_not_in_portfolio_400(user_with_position):
    username, uid, _ = user_with_position
    _set_byok(uid)
    client = _login(username)
    # 一个不在持仓/自选的 instrument
    other_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(Instrument(id=other_id, asset_class="equity", exchange="SSE", canonical_symbol="600000",
                         display_code="600000", name="别的", market="沪市主板", provider_ids={},
                         created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
    resp = client.post("/api/v1/debates", json={"instrument_id": str(other_id), "horizon": "swing"},
                       headers=_csrf(client))
    assert resp.status_code == 400
    with SessionLocal() as s:
        s.execute(delete(Instrument).where(Instrument.id == other_id))
        s.commit()
