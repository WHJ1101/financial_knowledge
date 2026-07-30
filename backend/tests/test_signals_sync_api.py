"""飞书信号同步运行 API：权限、入队、范围和轮询语义。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import SourceSyncRun, User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"sy_{uuid.uuid4().hex[:8]}"
    uid = uuid.uuid4()
    with SessionLocal() as session:
        session.add(
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
        session.commit()
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


def _csrf(client: TestClient) -> dict[str, str]:
    return {
        "X-CSRF-Token": client.cookies.get("fk_csrf") or "",
        "Origin": "http://localhost:5173",
    }


@pytest.fixture
def cleanup_rows():
    user_ids: list[uuid.UUID] = []
    run_ids: list[uuid.UUID] = []
    yield user_ids, run_ids
    with SessionLocal() as session:
        if run_ids:
            session.execute(delete(SourceSyncRun).where(SourceSyncRun.id.in_(run_ids)))
        if user_ids:
            session.execute(delete(UserSession).where(UserSession.user_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))
        session.commit()


def test_signal_sync_run_endpoints_are_hidden_from_members(cleanup_rows):
    user_ids, _ = cleanup_rows
    name, user_id = _mk_user("member")
    user_ids.append(user_id)
    client = _login(name)

    response = client.post(
        "/api/v1/signals/sync-runs",
        json={"mode": "incremental"},
        headers=_csrf(client),
    )
    assert response.status_code == 404
    assert client.get("/api/v1/signals/sync-runs/latest").status_code == 404


def test_signal_sync_enqueue_returns_202_and_poll_url(cleanup_rows, monkeypatch):
    user_ids, _ = cleanup_rows
    name, user_id = _mk_user("superadmin")
    user_ids.append(user_id)
    run_id = uuid.uuid4()
    monkeypatch.setattr(
        "app.api.signals._enqueue_signal_sync",
        lambda *_args, **_kwargs: SimpleNamespace(id=run_id, status="queued"),
    )
    client = _login(name)

    response = client.post(
        "/api/v1/signals/sync-runs",
        json={"mode": "incremental", "date_from": None, "date_to": None},
        headers=_csrf(client),
    )

    assert response.status_code == 202, response.text
    assert response.json() == {
        "run_id": str(run_id),
        "status": "queued",
        "poll_url": f"/api/v1/signals/sync-runs/{run_id}",
    }


def test_signal_sync_backfill_rejects_more_than_90_days(cleanup_rows):
    user_ids, _ = cleanup_rows
    name, user_id = _mk_user("superadmin")
    user_ids.append(user_id)
    client = _login(name)

    response = client.post(
        "/api/v1/signals/sync-runs",
        json={"mode": "backfill", "date_from": "2026-01-01", "date_to": "2026-04-01"},
        headers=_csrf(client),
    )

    assert response.status_code == 422


def test_signal_sync_latest_returns_ledger_view(cleanup_rows):
    user_ids, run_ids = cleanup_rows
    name, user_id = _mk_user("superadmin")
    user_ids.append(user_id)
    run_id = uuid.uuid4()
    run_ids.append(run_id)
    with SessionLocal() as session:
        session.add(
            SourceSyncRun(
                id=run_id,
                source_key="feishu.signal",
                capability_key="signal.feishu.sections",
                trigger="manual",
                request_fingerprint=uuid.uuid4().hex,
                idempotency_key=f"test:{run_id}",
                status="partial",
                stage="extract",
                scanned_count=3,
                changed_count=2,
                written_count=1,
                failed_count=1,
                result_summary={"failure_dates": ["2026-07-28"]},
            )
        )
        session.commit()
    client = _login(name)

    response = client.get("/api/v1/signals/sync-runs/latest")

    assert response.status_code == 200
    assert response.json()["id"] == str(run_id)
    assert response.json()["status"] == "partial"
    assert response.json()["result_summary"]["failure_dates"] == ["2026-07-28"]
