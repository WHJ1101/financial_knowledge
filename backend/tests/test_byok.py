"""多 Profile BYOK、Agent 路由、加密与 SSRF 测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.crypto import decrypt_api_key, encrypt_api_key, mask_api_key
from app.db import SessionLocal
from app.llm.client import make_role_chat_router
from app.llm.context import LlmEndpointError, validate_endpoint
from app.main import app
from app.models import LlmAgentRoute, LlmProfile, User, UserSession


def test_encrypt_decrypt_roundtrip():
    key = "sk-test-1234567890abcdef"
    ciphertext = encrypt_api_key(key)
    assert ciphertext != key
    assert decrypt_api_key(ciphertext) == key


def test_mask_api_key():
    assert mask_api_key("sk-test-1234567890abcd") == "sk-****abcd"
    assert mask_api_key("short") == "****"


def test_ssrf_rejects_http():
    with pytest.raises(LlmEndpointError):
        validate_endpoint("http://api.openai.com/v1")


def test_ssrf_rejects_non_allowlist():
    with pytest.raises(LlmEndpointError):
        validate_endpoint("https://evil.example.com/v1")


def test_ssrf_allows_localhost_http():
    validate_endpoint("http://localhost/v1", allow_local=True)


def test_ssrf_rejects_localhost_in_production_mode():
    with pytest.raises(LlmEndpointError):
        validate_endpoint("http://localhost/v1")


def _mk_user() -> tuple[str, uuid.UUID]:
    from app.core.security import hash_password

    username = f"m7_{uuid.uuid4().hex[:8]}"
    user_id = uuid.uuid4()
    with SessionLocal() as session:
        session.add(
            User(
                id=user_id,
                username=username,
                password_hash=hash_password("pass-1234"),
                role="member",
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        session.commit()
    return username, user_id


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
    return {"X-CSRF-Token": client.cookies.get("fk_csrf") or "", "Origin": "http://localhost:5173"}


@pytest.fixture
def member():
    name, user_id = _mk_user()
    yield name, user_id
    with SessionLocal() as session:
        session.execute(delete(LlmAgentRoute).where(LlmAgentRoute.user_id == user_id))
        session.execute(delete(LlmProfile).where(LlmProfile.user_id == user_id))
        session.execute(delete(UserSession).where(UserSession.user_id == user_id))
        session.execute(delete(User).where(User.id == user_id))
        session.commit()


def test_multiple_profiles_and_agent_routes(member, monkeypatch):
    monkeypatch.setattr("app.api.settings.validate_endpoint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.llm.client.validate_endpoint", lambda *_args, **_kwargs: None)
    name, user_id = member
    client = _login(name)
    first = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "分析模型",
            "api_key": "sk-secret-key-abcd1234",
            "api_url": "https://openrouter.ai/api/v1",
            "model": "model-a",
            "is_default": True,
        },
        headers=_csrf(client),
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "裁判模型",
            "api_key": "sk-second-key-efgh5678",
            "api_url": "https://openrouter.ai/api/v1",
            "model": "model-b",
            "is_default": False,
        },
        headers=_csrf(client),
    )
    assert second.status_code == 201, second.text
    assert first.json()["key_hint"] == "sk-****1234"
    assert "secret" not in str(first.json())

    routed = client.put(
        "/api/v1/settings/llm/routes",
        json=[{"role": "judge", "profile_id": second.json()["id"], "temperature": 0.1}],
        headers=_csrf(client),
    )
    assert routed.status_code == 200, routed.text
    settings = client.get("/api/v1/settings/llm").json()
    assert len(settings["profiles"]) == 2
    assert settings["routes"][0]["role"] == "judge"

    with SessionLocal() as session:
        profiles = list(session.execute(select(LlmProfile).where(LlmProfile.user_id == user_id)).scalars())
        assert all("sk-" not in profile.api_key_ciphertext for profile in profiles)
        router = make_role_chat_router(session, str(user_id), "debate", "run-1")
        snapshot = router.snapshot()
        assert snapshot["technical"]["model"] == "model-a"
        assert snapshot["judge"]["model"] == "model-b"

    blocked = client.patch(
        f"/api/v1/settings/llm/profiles/{second.json()['id']}",
        json={"enabled": False},
        headers=_csrf(client),
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "llm_profile_in_use"
    assert client.put("/api/v1/settings/llm/routes", json=[], headers=_csrf(client)).status_code == 200
    disabled = client.patch(
        f"/api/v1/settings/llm/profiles/{second.json()['id']}",
        json={"enabled": False},
        headers=_csrf(client),
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False


def test_create_default_profile_replaces_existing_default(member, monkeypatch):
    monkeypatch.setattr("app.api.settings.validate_endpoint", lambda *_args, **_kwargs: None)
    name, user_id = member
    client = _login(name)

    first = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "原默认模型",
            "api_key": "sk-first-default-credential",
            "api_url": "https://openrouter.ai/api/v1",
            "model": "model-a",
            "is_default": True,
        },
        headers=_csrf(client),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "新默认模型",
            "api_key": "sk-second-default-credential",
            "api_url": "https://openrouter.ai/api/v1/chat/completions",
            "model": "model-b",
            "is_default": True,
        },
        headers=_csrf(client),
    )
    assert second.status_code == 201, second.text

    with SessionLocal() as session:
        profiles = list(
            session.execute(
                select(LlmProfile).where(LlmProfile.user_id == user_id).order_by(LlmProfile.created_at)
            ).scalars()
        )
        assert [profile.is_default for profile in profiles] == [False, True]


def test_profile_rejects_ssrf(member):
    name, _ = member
    client = _login(name)
    response = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "bad",
            "api_key": "sk-xxxxxxxx",
            "api_url": "https://evil.example.com/v1",
            "model": "m",
            "is_default": True,
        },
        headers=_csrf(client),
    )
    assert response.status_code == 400


def test_settings_empty_when_unset(member):
    name, _ = member
    client = _login(name)
    response = client.get("/api/v1/settings/llm")
    assert response.status_code == 200
    assert response.json()["profiles"] == []


def test_settings_keeps_loading_when_one_profile_cannot_be_decrypted(member, monkeypatch):
    monkeypatch.setattr("app.api.settings.validate_endpoint", lambda *_args, **_kwargs: None)
    name, user_id = member
    client = _login(name)
    created = client.post(
        "/api/v1/settings/llm/profiles",
        json={
            "name": "待修复模型",
            "api_key": "sk-invalid-after-key-rotation",
            "api_url": "https://openrouter.ai/api/v1",
            "model": "model-a",
            "is_default": True,
        },
        headers=_csrf(client),
    )
    assert created.status_code == 201, created.text

    with SessionLocal() as session:
        profile = session.execute(
            select(LlmProfile).where(LlmProfile.user_id == user_id)
        ).scalar_one()
        profile.api_key_ciphertext = "not-a-valid-fernet-token"
        session.commit()

    response = client.get("/api/v1/settings/llm")
    assert response.status_code == 200
    assert response.json()["profiles"][0]["key_status"] == "invalid"
    assert response.json()["profiles"][0]["key_hint"] == "不可用"


def test_profile_rejects_whitespace_fields(member, monkeypatch):
    monkeypatch.setattr("app.api.settings.validate_endpoint", lambda *_args, **_kwargs: None)
    name, _ = member
    client = _login(name)
    response = client.post(
        "/api/v1/settings/llm/profiles",
        json={"name": "   ", "api_key": "sk-xxxxxxxx", "api_url": "https://openrouter.ai", "model": "m"},
        headers=_csrf(client),
    )
    assert response.status_code == 422


def test_agent_route_rejects_another_users_profile(member, monkeypatch):
    monkeypatch.setattr("app.api.settings.validate_endpoint", lambda *_args, **_kwargs: None)
    owner_name, owner_id = member
    other_name, other_id = _mk_user()
    try:
        owner_client = _login(owner_name)
        profile = owner_client.post(
            "/api/v1/settings/llm/profiles",
            json={
                "name": "归属测试",
                "api_key": "sk-owner-only-credential",
                "api_url": "https://openrouter.ai/api/v1",
                "model": "owner-model",
                "is_default": True,
            },
            headers=_csrf(owner_client),
        )
        assert profile.status_code == 201, profile.text

        other_client = _login(other_name)
        response = other_client.put(
            "/api/v1/settings/llm/routes",
            json=[{"role": "judge", "profile_id": profile.json()["id"], "temperature": 0.1}],
            headers=_csrf(other_client),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "llm_profile_not_found"
        with SessionLocal() as session:
            routes = list(session.execute(select(LlmAgentRoute).where(LlmAgentRoute.user_id == other_id)).scalars())
            assert routes == []
    finally:
        with SessionLocal() as session:
            session.execute(delete(LlmAgentRoute).where(LlmAgentRoute.user_id == other_id))
            session.execute(delete(LlmProfile).where(LlmProfile.user_id == other_id))
            session.execute(delete(UserSession).where(UserSession.user_id == other_id))
            session.execute(delete(User).where(User.id == other_id))
            session.commit()
