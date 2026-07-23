"""M2 鉴权集成测试（方案 §14.1）。用真实 PG（JSONB 依赖）。

覆盖：登录成功/错误密码/禁用用户、邀请码注册/过期/撤销/有效期内复用、session 撤销、CSRF、限流。
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
        u = User(
            id=uuid.uuid4(),
            username=username,
            password_hash=hash_password("admin-pass-123"),
            role="superadmin",
            status="active",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
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


def test_csrf_cookie_lifetime_matches_token_lifetime():
    resp = TestClient(app).get("/api/v1/auth/csrf")

    assert resp.status_code == 200
    assert "Max-Age=86400" in resp.headers["set-cookie"]


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


def test_failed_logins_are_rate_limited_even_when_auth_rolls_back(admin_user):
    username, _, _ = admin_user
    client, headers = _client_with_csrf()
    statuses = [
        client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": "wrong"},
            headers=headers,
        ).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_login_without_csrf_rejected(admin_user):
    username, password, _ = admin_user
    client = TestClient(app)
    resp = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"],
)
def test_local_dev_origins_pass_csrf_origin_check(admin_user, origin):
    username, _, _ = admin_user
    client = TestClient(app)
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    resp = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "wrong-password"},
        headers={"X-CSRF-Token": token, "Origin": origin},
    )
    # Origin 已通过，后续才会进入用户名/密码校验。
    assert resp.status_code == 401, resp.text


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

    new_usernames = [f"member_{uuid.uuid4().hex[:8]}", f"member_{uuid.uuid4().hex[:8]}"]
    try:
        # 同一有效邀请码可供多个不同用户注册。
        for new_username in new_usernames:
            anonymous, anonymous_headers = _client_with_csrf()
            reg = anonymous.post(
                "/api/v1/auth/register",
                json={"invite_code": code, "username": new_username, "password": "member-pass-123"},
                headers=anonymous_headers,
            )
            assert reg.status_code == 200, reg.text
            assert reg.json()["user"]["role"] == "member"

        listed = client.get("/api/v1/invites")
        invite_row = next(item for item in listed.json() if item["id"] == inv.json()["id"])
        assert "used_by" not in invite_row
        assert "used_at" not in invite_row
    finally:
        with SessionLocal() as s:
            s.execute(delete(InviteCode).where(InviteCode.created_by == uid))
            s.execute(delete(User).where(User.username.in_(new_usernames)))
            s.commit()


def test_invite_can_be_revoked(admin_user):
    username, password, uid = admin_user
    client, headers = _client_with_csrf()
    client.post("/api/v1/auth/login", json={"username": username, "password": password}, headers=headers)
    created = client.post(
        "/api/v1/invites",
        json={"ttl_hours": 24, "hint": "revoke"},
        headers=_csrf_headers(client),
    )
    assert created.status_code == 200
    data = created.json()
    registered_username = f"member_{uuid.uuid4().hex[:8]}"
    try:
        first_anonymous, first_headers = _client_with_csrf()
        first_registration = first_anonymous.post(
            "/api/v1/auth/register",
            json={
                "invite_code": data["code"],
                "username": registered_username,
                "password": "member-pass-123",
            },
            headers=first_headers,
        )
        assert first_registration.status_code == 200

        # 已经成功注册过用户的邀请码仍可由管理员撤销。
        revoked = client.post(f"/api/v1/invites/{data['id']}/revoke", headers=_csrf_headers(client))
        assert revoked.status_code == 200
        assert revoked.json()["revoked_at"] is not None

        anonymous, anonymous_headers = _client_with_csrf()
        registration = anonymous.post(
            "/api/v1/auth/register",
            json={
                "invite_code": data["code"],
                "username": f"member_{uuid.uuid4().hex[:8]}",
                "password": "member-pass-123",
            },
            headers=anonymous_headers,
        )
        assert registration.status_code == 400
    finally:
        with SessionLocal() as session:
            session.execute(delete(InviteCode).where(InviteCode.created_by == uid))
            session.execute(delete(User).where(User.username == registered_username))
            session.commit()


def test_expired_invite_rejected(admin_user):
    _, _, uid = admin_user
    # 直接插一个已过期邀请码
    code_plain = "expired-code-xyz"  # noqa: S105 (测试固定值)
    with SessionLocal() as s:
        s.add(
            InviteCode(
                id=uuid.uuid4(),
                code_hash=token_digest(code_plain),
                code_hint="exp",
                created_by=uid,
                expires_at=datetime.now(UTC) - timedelta(hours=1),
                created_at=datetime.now(UTC),
            )
        )
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
