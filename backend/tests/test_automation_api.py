"""M11.6/8/9 任务自动化 + 导出 + 状态 API 集成测试（方案 §14）。

自动化：CRUD/toggle/schedule/logs 全部限超管；tick dispatcher 到点入队。
导出：按 owner 隔离持仓、按可见性过滤报告；CSV/JSON。
状态：报告统计 + BYOK + 市场就绪。
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
from app.models import AutomationRun, AutomationTask, Report, Setting, User, UserSession


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"au_{uuid.uuid4().hex[:8]}"
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
def superadmin():
    name, uid = _mk_user("superadmin")
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(AutomationTask).where(AutomationTask.execution_owner_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.owner_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_automation_requires_superadmin(member):
    name, _ = member
    client = _login(name)
    assert client.get("/api/v1/automation/tasks").status_code == 404
    assert client.get("/api/v1/automation/runs").status_code == 404
    assert client.get("/api/v1/source-sync-runs").status_code == 404
    assert client.get("/api/v1/logs").status_code == 404


def test_automation_run_list_and_detail(superadmin):
    name, uid = superadmin
    run_id = uuid.uuid4()
    now = datetime.now(UTC)
    with SessionLocal() as session:
        session.add(
            AutomationRun(
                id=run_id,
                kind=f"api_test_{uuid.uuid4().hex[:8]}",
                trigger="manual",
                requested_by=uid,
                status="succeeded",
                step_summary=[{"key": "market", "status": "succeeded"}],
                started_at=now,
                finished_at=now,
            )
        )
        session.commit()
    try:
        client = _login(name)
        listed = client.get("/api/v1/automation/runs")
        assert listed.status_code == 200
        assert any(item["id"] == str(run_id) for item in listed.json()["runs"])
        detail = client.get(f"/api/v1/automation/runs/{run_id}")
        assert detail.status_code == 200
        assert detail.json()["steps"][0]["key"] == "market"
        missing = client.get(f"/api/v1/automation/runs/{uuid.uuid4()}")
        assert missing.status_code == 404
        assert missing.json()["detail"]["code"] == "run_not_found"
    finally:
        with SessionLocal() as session:
            session.execute(delete(AutomationRun).where(AutomationRun.id == run_id))
            session.commit()


def test_task_crud_and_toggle_schedule(superadmin):
    name, _ = superadmin
    client = _login(name)
    # 创建
    resp = client.post(
        "/api/v1/automation/tasks",
        json={"name": "每日市场简报", "goal": "跟踪大盘", "implementation": "日更简报", "schedule": "09:30"},
        headers=_csrf(client),
    )
    assert resp.status_code == 201, resp.text
    task = resp.json()["task"]
    assert task["enabled"] is False
    assert task["scheduleTime"] == "09:30"
    assert task["executable"] is True  # 命中「日更简报」
    tid = task["id"]
    # 列表
    tasks = client.get("/api/v1/automation/tasks").json()["tasks"]
    assert any(t["id"] == tid for t in tasks)
    # 启停
    toggled = client.post(f"/api/v1/automation/tasks/{tid}/toggle", headers=_csrf(client)).json()["task"]
    assert toggled["enabled"] is True
    # 改定时
    sched = client.post(
        f"/api/v1/automation/tasks/{tid}/schedule", json={"time": "14:45"}, headers=_csrf(client)
    ).json()["task"]
    assert sched["scheduleTime"] == "14:45"
    # 非法时间 → 400
    assert (
        client.post(f"/api/v1/automation/tasks/{tid}/schedule", json={"time": "bad"}, headers=_csrf(client)).status_code
        == 400
    )


def test_toggle_automation_global(superadmin):
    name, _ = superadmin
    client = _login(name)
    resp = client.post("/api/v1/automation/toggle", json={"enabled": True}, headers=_csrf(client))
    assert resp.status_code == 200
    assert resp.json()["settings"]["automationEnabled"] is True
    with SessionLocal() as s:
        s.execute(delete(Setting).where(Setting.key == "automationEnabled"))
        s.commit()


def test_pressure_sync_requires_superadmin_and_runs(superadmin, member, monkeypatch):
    async def fake_run(_session, source):
        return {"ranAt": "now", "themes": [], "signalsWritten": 0, "syncFailures": [], "source": source}

    monkeypatch.setattr("app.services.pressure_monitor.run_pressure_monitor", fake_run)
    member_client = _login(member[0])
    assert member_client.post("/api/v1/pressure/sync", headers=_csrf(member_client)).status_code == 404

    admin_client = _login(superadmin[0])
    response = admin_client.post("/api/v1/pressure/sync", headers=_csrf(admin_client))
    assert response.status_code == 201
    assert response.json()["signalsWritten"] == 0


def test_status_endpoint(member):
    name, uid = member
    client = _login(name)
    # 一篇自有报告
    with SessionLocal() as s:
        s.add(
            Report(
                id=f"st_{uuid.uuid4().hex[:8]}",
                owner_id=uid,
                visibility="private",
                title="t",
                topic="t",
                type="custom",
                origin="manual",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    resp = client.get("/api/v1/status")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["app"] == "financial_knowledge"
    assert data["reportCount"] >= 1
    assert "market" in data
    assert data["llm"]["configured"] is False


def test_export_positions_and_reports(member):
    name, uid = member
    client = _login(name)
    with SessionLocal() as s:
        s.add(
            Report(
                id=f"ex_{uuid.uuid4().hex[:8]}",
                owner_id=uid,
                visibility="private",
                title="导出报告",
                topic="t",
                type="custom",
                origin="manual",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    # JSON 导出
    rj = client.get("/api/v1/export/reports.json")
    assert rj.status_code == 200
    assert "reports" in rj.json()
    assert any(r["title"] == "导出报告" for r in rj.json()["reports"])
    # CSV 导出
    rc = client.get("/api/v1/export/positions.csv")
    assert rc.status_code == 200
    assert "attachment" in rc.headers["content-disposition"]
    assert "代码" in rc.text  # CSV 表头
    # 非法类型 → 404
    assert client.get("/api/v1/export/unknown.json").status_code == 404
    assert client.get("/api/v1/export/reports.xml").status_code == 404


def test_export_reports_isolated(member):
    name, uid = member
    client = _login(name)
    # 另一用户的私有报告不应出现在本人导出里
    other_name, other_uid = _mk_user()
    with SessionLocal() as s:
        s.add(
            Report(
                id=f"exo_{uuid.uuid4().hex[:8]}",
                owner_id=other_uid,
                visibility="private",
                title="他人私有",
                topic="t",
                type="custom",
                origin="manual",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    titles = [r["title"] for r in client.get("/api/v1/export/reports.json").json()["reports"]]
    assert "他人私有" not in titles
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.owner_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()
