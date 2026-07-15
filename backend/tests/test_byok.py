"""M7 测试：BYOK 加密/掩码、SSRF 校验、LLM 执行身份、调度 dispatcher。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.crypto import decrypt_api_key, encrypt_api_key, mask_api_key
from app.db import SessionLocal
from app.llm.context import LlmEndpointError, validate_endpoint
from app.main import app
from app.models import User, UserLlmConfig, UserSession

# ---- BYOK 加密（不连库）----


def test_encrypt_decrypt_roundtrip():
    key = "sk-test-1234567890abcdef"
    ct = encrypt_api_key(key)
    assert ct != key  # 密文不等于明文
    assert decrypt_api_key(ct) == key


def test_mask_api_key():
    assert mask_api_key("sk-test-1234567890abcd") == "sk-****abcd"
    assert mask_api_key("short") == "****"


# ---- SSRF 校验（§9.7）----


def test_ssrf_rejects_http():
    with pytest.raises(LlmEndpointError):
        validate_endpoint("http://api.openai.com/v1")


def test_ssrf_rejects_non_allowlist():
    with pytest.raises(LlmEndpointError):
        validate_endpoint("https://evil.example.com/v1")


def test_ssrf_allows_openrouter():
    validate_endpoint("https://openrouter.ai/api/v1")  # 不抛即通过


def test_ssrf_allows_localhost_http():
    validate_endpoint("http://localhost/v1")  # 开发允许


# ---- BYOK API（连库）----


def _mk_user() -> tuple[str, uuid.UUID]:
    from app.core.security import hash_password

    username = f"m7_{uuid.uuid4().hex[:8]}"
    uid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(User(id=uid, username=username, password_hash=hash_password("pass-1234"),
                   role="member", status="active", created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        s.commit()
    return username, uid


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post("/api/v1/auth/login", json={"username": username, "password": "pass-1234"},
                headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"})
    return client


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(UserLlmConfig).where(UserLlmConfig.user_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_byok_put_get_masked(member):
    name, uid = member
    client = _login(name)
    put = client.put("/api/v1/settings/llm",
                     json={"api_key": "sk-secret-key-abcd1234", "api_url": "https://openrouter.ai/api/v1",
                           "model": "openai/gpt-4o-mini"}, headers=_csrf(client))
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["configured"] is True
    assert body["key_hint"] == "sk-****1234"  # 掩码回显
    assert "secret" not in str(body)  # 绝不回显明文（§9.6）

    # 库内是密文，不是明文
    with SessionLocal() as s:
        cfg = s.get(UserLlmConfig, uid)
        assert cfg is not None
        assert "sk-secret" not in cfg.api_key_ciphertext
        assert decrypt_api_key(cfg.api_key_ciphertext) == "sk-secret-key-abcd1234"


def test_byok_put_rejects_ssrf(member):
    name, _ = member
    client = _login(name)
    resp = client.put("/api/v1/settings/llm",
                      json={"api_key": "sk-xxxxxxxx", "api_url": "https://evil.example.com/v1", "model": "m"},
                      headers=_csrf(client))
    assert resp.status_code == 400  # SSRF 拦截


def test_byok_get_none_when_unset(member):
    name, _ = member
    client = _login(name)
    assert client.get("/api/v1/settings/llm").json()["configured"] is False
