"""M11.5 信号同步 API 集成测试（方案 §14）。

/signals/sync：成员 → 404（超管专属）；超管 + 飞书未配 → skipped（不打真实飞书）。
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
from app.models import User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"sy_{uuid.uuid4().hex[:8]}"
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
def cleanup_users():
    uids: list[uuid.UUID] = []
    yield uids
    with SessionLocal() as s:
        for uid in uids:
            s.execute(delete(UserSession).where(UserSession.user_id == uid))
            s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_signals_sync_requires_superadmin(cleanup_users):
    name, uid = _mk_user("member")
    cleanup_users.append(uid)
    client = _login(name)
    assert client.post("/api/v1/signals/sync", headers=_csrf(client)).status_code == 404


def test_signals_sync_skips_when_feishu_unconfigured(cleanup_users, monkeypatch):
    # 确保飞书未配（清空 env）→ skipped
    for k in ("FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SIGNAL_WIKI_URL", "FEISHU_SIGNAL_URL"):
        monkeypatch.delenv(k, raising=False)
    name, uid = _mk_user("superadmin")
    cleanup_users.append(uid)
    client = _login(name)
    resp = client.post("/api/v1/signals/sync", headers=_csrf(client))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["skipped"] is True
    assert "未配置" in data["reason"]
