"""M11.2 研报生产 API 集成测试（方案 §14）。

/research：未配 key 降级证据草稿（201 + 报告落库私有）。
/jobs/daily：成员触发 → 404（require_superadmin）；不打真实新闻/行情外网（打桩）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, text

from app.config import get_settings
from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import AutomationRun, Log, Report, User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"job_{uuid.uuid4().hex[:8]}"
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
def tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path), raising=False)
    return tmp_path


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.owner_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


@pytest.fixture
def superadmin():
    name, uid = _mk_user("superadmin")
    yield name, uid
    with SessionLocal() as s:
        s.execute(text("DELETE FROM procrastinate_jobs WHERE task_name='fk:run_daily'"))
        s.execute(delete(AutomationRun).where(AutomationRun.requested_by == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_research_requires_auth():
    client = TestClient(app)
    assert client.post("/api/v1/research", json={"topic": "x"}).status_code in (401, 403)


def test_research_degrades_without_key(tmp_data_dir, member):
    name, uid = member
    client = _login(name)
    resp = client.post("/api/v1/research", json={"topic": "AI算力产业链", "type": "industry"}, headers=_csrf(client))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["type"] == "industry"
    assert data["summary"]
    # 报告落库 + 私有 + 属主
    with SessionLocal() as s:
        row = s.get(Report, data["id"])
        assert row is not None
        assert row.owner_id == uid
        assert row.visibility == "private"
        s.execute(delete(Log).where(Log.type == "research"))
        s.commit()


def test_daily_job_requires_superadmin(member):
    name, _ = member
    client = _login(name)
    # 成员触发日更 → 404（require_superadmin 不泄露）
    resp = client.post("/api/v1/jobs/daily", headers=_csrf(client))
    assert resp.status_code == 404


def test_daily_job_returns_run_and_enqueues_atomically(superadmin):
    name, uid = superadmin
    client = _login(name)
    resp = client.post("/api/v1/jobs/daily", headers=_csrf(client))
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["poll_url"] == f"/api/v1/automation/runs/{body['run_id']}"
    with SessionLocal() as session:
        run = session.get(AutomationRun, uuid.UUID(body["run_id"]))
        assert run is not None
        assert run.requested_by == uid
        assert isinstance(run.queue_job_id, int)
        queued = session.execute(
            text("SELECT task_name, args->>'run_id' FROM procrastinate_jobs WHERE id=:id"),
            {"id": run.queue_job_id},
        ).one()
        assert queued == ("fk:run_daily", body["run_id"])

    active = client.post("/api/v1/jobs/daily", headers=_csrf(client))
    assert active.status_code == 409
    assert active.json()["detail"]["code"] == "active_run_exists"
