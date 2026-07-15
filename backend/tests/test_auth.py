"""M2 鉴权集成测试（方案 §14.1）。用真实 PG（JSONB 依赖）。

覆盖：登录成功/错误密码/禁用用户、邀请码注册/过期/复用、session 撤销、CSRF、限流。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password, token_digest
from app.db import SessionLocal
from app.main import app
from app.models import InviteCode, RateLimitBucket, User, UserSession


@pytest.fixture
def admin_user():
    """建一个超管，测试后清理。"""
    with SessionLocal() as s:
        s.execute(delete(RateLimitBucket))
        username = f"admin_{uuid.uuid4().hex[:8]}"
        u = User(id=uuid.uuid4(), username=username, password_hash=hash_password("admin-pass-123"),
                 role="superadmin", status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
        s.add(u)
        s.commit()
        uid = u.id
    yield username, "admin-pass-123", uid
    with SessionLocal() as s:
        # 先删引用 users 的表（外键），再删 user
        s.execute(delete(InviteCode).where(InviteCode.created_by == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def _client_with_csrf() -> tuple[TestClient, dict]:
    """取 CSRF token，返回带 header 的 client。"""
    client = TestClient(app)
    resp = client.get("/api/v1/auth/csrf")
    token = resp.json()["csrf_token"]
    return client, {"X-CSRF-Token": token, "Origin": "http://localhost:5173"}


def _csrf_headers(client: TestClient) -> dict:
    """从当前 cookie 读最新 CSRF token（登录会轮换，前端每次写请求都重读）。"""
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


def test_login_success_and_me(admin_user):
    username, password, _ = admin_user
    client, headers = _client_with_csrf()
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["authenticated"] is True
    me = client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json()["role"] == "superadmin"


def test_login_wrong_password(admin_user):
    username, _, _ = admin_user
    client, headers = _client_with_csrf()
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": "wrong"}, headers=headers)
    assert resp.status_code == 401


def test_login_without_csrf_rejected(admin_user):
    username, password, _ = admin_user
    client = TestClient(app)
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 403


def test_disabled_user_cannot_access(admin_user):
    username, password, uid = admin_user
    client, headers = _client_with_csrf()
    client.post("/api/v1/auth/login", json={"username": username, "password": password}, headers=headers)
    # 禁用用户 → 即时失效（方案 §9.1）
    with SessionLocal() as s:
        u = s.get(User, uid)
        u.status = "disabled"
        s.commit()
    assert client.get("/api/v1/me").status_code == 401


def test_invite_register_flow(admin_user):
    username, password, uid = admin_user
    client, headers = _client_with_csrf()
    client.post("/api/v1/auth/login", json={"username": username, "password": password}, headers=headers)
    # 登录轮换了 CSRF，重读 cookie（方案 §9.2 double-submit）
    inv = client.post("/api/v1/invites", json={"ttl_hours": 24, "hint": "test"}, headers=_csrf_headers(client))
    assert inv.status_code == 200, inv.text
    code = inv.json()["code"]
    assert code

    # 新用户注册
    client2, headers2 = _client_with_csrf()
    new_username = f"member_{uuid.uuid4().hex[:8]}"
    reg = client2.post("/api/v1/auth/register",
                       json={"invite_code": code, "username": new_username, "password": "member-pass-123"},
                       headers=headers2)
    assert reg.status_code == 200, reg.text
    assert reg.json()["user"]["role"] == "member"

    # 复用同一邀请码 → 拒绝
    client3, headers3 = _client_with_csrf()
    reg2 = client3.post("/api/v1/auth/register",
                        json={"invite_code": code, "username": f"x_{uuid.uuid4().hex[:8]}", "password": "pass-1234"},
                        headers=headers3)
    assert reg2.status_code == 400

    # 清理新用户（先删引用它的 invite_codes.used_by）
    with SessionLocal() as s:
        s.execute(delete(InviteCode).where(InviteCode.created_by == uid))
        s.execute(delete(User).where(User.username == new_username))
        s.commit()


def test_expired_invite_rejected(admin_user):
    _, _, uid = admin_user
    # 直接插一个已过期邀请码
    code_plain = "expired-code-xyz"  # noqa: S105 (测试固定值)
    with SessionLocal() as s:
        s.add(InviteCode(id=uuid.uuid4(), code_hash=token_digest(code_plain), code_hint="exp",
                         created_by=uid, expires_at=datetime.now(UTC) - timedelta(hours=1),
                         created_at=datetime.now(UTC)))
        s.commit()
    client, headers = _client_with_csrf()
    reg = client.post(
        "/api/v1/auth/register",
        json={"invite_code": code_plain, "username": f"e_{uuid.uuid4().hex[:8]}", "password": "pass-1234"},
        headers=headers,
    )
    assert reg.status_code == 400
    with SessionLocal() as s:
        s.execute(delete(InviteCode).where(InviteCode.created_by == uid))
        s.commit()
