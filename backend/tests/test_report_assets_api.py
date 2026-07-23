"""M11.3 报告导入/删除/资产 API 集成测试（方案 §14）。

导入：Import Token → owner=超管、private；无 token → 401。
删除：仅 owner=self；越权 → 404；文件+DB+日志。
资产：建链需报告属主；关联读受报告可见性约束；越权删链 → 404。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.config import get_settings
from app.core.security import hash_password, token_digest
from app.db import SessionLocal
from app.main import app
from app.models import (
    Instrument,
    Log,
    Report,
    ReportAssetLink,
    User,
    UserSession,
)


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"ra_{uuid.uuid4().hex[:8]}"
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
def superadmin():
    name, uid = _mk_user("superadmin")
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.owner_id == uid))
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


def test_import_without_token_401(tmp_data_dir, monkeypatch):
    monkeypatch.setattr(get_settings(), "import_token", "", raising=False)
    client = TestClient(app)
    resp = client.post("/api/v1/reports/import", json={"title": "x", "topic": "x"})
    assert resp.status_code == 401


def test_import_with_token_owner_superadmin(tmp_data_dir, superadmin, monkeypatch):
    monkeypatch.setattr(get_settings(), "import_token", "secret-import-token", raising=False)
    client = TestClient(app)
    resp = client.post(
        "/api/v1/reports/import",
        json={"title": "导入的政策报告", "topic": "工信部新政策", "content": "正文"},
        headers={"X-Import-Token": "secret-import-token"},
    )
    assert resp.status_code == 201, resp.text
    rid = resp.json()["report"]["id"]
    with SessionLocal() as s:
        row = s.get(Report, rid)
        assert row is not None
        owner = s.get(User, row.owner_id)
        assert owner is not None and owner.role == "superadmin"  # 归超管（最早创建的超管）
        assert row.visibility == "private"  # 默认私有
        s.execute(delete(Log).where(Log.type == "report_import"))
        s.execute(delete(Report).where(Report.id == rid))
        s.commit()


def test_import_rejects_expired_admin_session(tmp_data_dir, superadmin, monkeypatch):
    monkeypatch.setattr(get_settings(), "import_token", "", raising=False)
    _, admin_id = superadmin
    raw_token = "expired-admin-session-token"
    with SessionLocal() as session:
        session.add(
            UserSession(
                id=uuid.uuid4(),
                user_id=admin_id,
                token_hash=token_digest(raw_token),
                expires_at=datetime.now(UTC) - timedelta(minutes=1),
                created_at=datetime.now(UTC) - timedelta(days=8),
                last_seen_at=datetime.now(UTC) - timedelta(days=8),
            )
        )
        session.commit()
    client = TestClient(app)
    client.cookies.set("fk_session", raw_token)
    response = client.post("/api/v1/reports/import", json={"title": "x", "topic": "x"})
    assert response.status_code == 401


def test_delete_report_owner_only(tmp_data_dir, member):
    name, uid = member
    other_name, other_uid = _mk_user()
    client = _login(name)
    other = _login(other_name)
    # 建一篇属于 member 的报告（直接落库 + 空文件）
    rid = f"del_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        s.add(
            Report(
                id=rid,
                owner_id=uid,
                visibility="private",
                title="待删",
                topic="t",
                type="custom",
                file=f"2026-07-15/{rid}.html",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    # 他人删 → 404
    assert other.request("DELETE", f"/api/v1/reports/{rid}", headers=_csrf(other)).status_code == 404
    # 属主删 → 200
    assert client.request("DELETE", f"/api/v1/reports/{rid}", headers=_csrf(client)).status_code == 200
    with SessionLocal() as s:
        assert s.get(Report, rid) is None
        s.execute(delete(Log).where(Log.type == "report_delete"))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()


def test_report_visibility_owner_only(tmp_data_dir, member):
    name, uid = member
    other_name, other_uid = _mk_user()
    client = _login(name)
    other = _login(other_name)
    rid = f"visibility_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        s.add(
            Report(
                id=rid,
                owner_id=uid,
                visibility="private",
                title="可见性测试",
                topic="t",
                type="custom",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()

    endpoint = f"/api/v1/reports/{rid}/visibility"
    assert other.patch(endpoint, json={"visibility": "shared"}, headers=_csrf(other)).status_code == 404
    assert client.patch(endpoint, json={"visibility": "shared"}, headers=_csrf(client)).status_code == 200
    assert rid in {row["id"] for row in other.get("/api/v1/reports").json()}
    assert client.patch(endpoint, json={"visibility": "private"}, headers=_csrf(client)).status_code == 200
    assert rid not in {row["id"] for row in other.get("/api/v1/reports").json()}

    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.id == rid))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()


def test_report_asset_link_crud_and_ownership(tmp_data_dir, member):
    name, uid = member
    other_name, other_uid = _mk_user()
    client = _login(name)
    other = _login(other_name)
    rid = f"ral_{uuid.uuid4().hex[:8]}"
    sym = uuid.uuid4().hex[:6]
    with SessionLocal() as s:
        s.add(
            Report(
                id=rid,
                owner_id=uid,
                visibility="private",
                title="带资产",
                topic="t",
                type="custom",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    # 他人建链 → 404
    assert (
        other.post(f"/api/v1/reports/{rid}/assets", json={"assetCode": f"SZ{sym}"}, headers=_csrf(other)).status_code
        == 404
    )
    # 属主建链 → 200
    resp = client.post(
        f"/api/v1/reports/{rid}/assets",
        json={"assetCode": f"SZ{sym}", "assetName": "测试标的", "assetMarket": "创业板"},
        headers=_csrf(client),
    )
    assert resp.status_code == 200, resp.text
    link_id = resp.json()["asset"]["id"]
    # 读关联
    assets = client.get(f"/api/v1/reports/{rid}/assets").json()["assets"]
    assert len(assets) == 1
    assert assets[0]["assetName"] == "测试标的"
    # 他人删链 → 404
    assert other.request("DELETE", f"/api/v1/report-asset-links/{link_id}", headers=_csrf(other)).status_code == 404
    # 属主删链 → 200
    dele = client.request("DELETE", f"/api/v1/report-asset-links/{link_id}", headers=_csrf(client))
    assert dele.status_code == 200 and dele.json()["deleted"] is True
    with SessionLocal() as s:
        s.execute(delete(ReportAssetLink).where(ReportAssetLink.report_id == rid))
        s.execute(delete(Log).where(Log.type == "report_asset_link"))
        s.execute(delete(Report).where(Report.id == rid))
        s.execute(delete(Instrument).where(Instrument.canonical_symbol == sym))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()


def test_report_content_visibility(tmp_data_dir, member):
    name, uid = member
    client = _login(name)
    rid = f"cnt_{uuid.uuid4().hex[:8]}"
    from app.services.report_store import write_report_file

    write_report_file(f"2026-07-15/{rid}.html", "<html>报告正文</html>")
    with SessionLocal() as s:
        s.add(
            Report(
                id=rid,
                owner_id=uid,
                visibility="private",
                title="内容",
                topic="t",
                type="custom",
                file=f"2026-07-15/{rid}.html",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    resp = client.get(f"/api/v1/reports/{rid}/content")
    assert resp.status_code == 200
    assert "报告正文" in resp.text
    # 他人访问私有内容 → 404
    other_name, other_uid = _mk_user()
    other = _login(other_name)
    assert other.get(f"/api/v1/reports/{rid}/content").status_code == 404
    with SessionLocal() as s:
        s.execute(delete(Report).where(Report.id == rid))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        s.commit()
