"""M11.X 旧决策归档只读端点测试（方案 §14/ADR-023）。

GET /decisions：成员 → 404（超管专属）；超管 → 200 返回归档（每天最新一条，倒序）。
无生成端点（旧 POST /decisions/daily 已砍）。
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
from app.models import Decision, User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"dc_{uuid.uuid4().hex[:8]}"
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


@pytest.fixture
def users():
    uids: list[uuid.UUID] = []
    yield uids
    with SessionLocal() as s:
        for uid in uids:
            s.execute(delete(UserSession).where(UserSession.user_id == uid))
            s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_decisions_requires_superadmin(users):
    name, uid = _mk_user("member")
    users.append(uid)
    client = _login(name)
    assert client.get("/api/v1/decisions").status_code == 404


def test_decisions_archive_dedup_by_date(users):
    name, uid = _mk_user("superadmin")
    users.append(uid)
    client = _login(name)
    did1 = f"decision-{uuid.uuid4().hex[:8]}"
    did2 = f"decision-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        # 同一天两条 → 只保留最新（created_at 大者）
        s.add(Decision(id=did1, date="2026-07-10", title="旧", summary="s", created_at="2026-07-10T08:00:00Z"))
        s.add(Decision(id=did2, date="2026-07-10", title="新", summary="s", created_at="2026-07-10T09:00:00Z"))
        s.commit()
    data = client.get("/api/v1/decisions").json()["decisions"]
    same_day = [d for d in data if d["date"] == "2026-07-10"]
    assert len(same_day) == 1
    assert same_day[0]["title"] == "新"
    with SessionLocal() as s:
        s.execute(delete(Decision).where(Decision.id.in_([did1, did2])))
        s.commit()


def test_no_daily_decision_generation_endpoint():
    # 旧 POST /decisions/daily 已砍（ADR-023）
    schema = app.openapi()
    assert "/api/v1/decisions/daily" not in schema["paths"]
