"""生产配置启动门禁。"""

import base64

import pytest

from app.config import Settings, validate_runtime_settings


def test_development_configuration_does_not_require_production_secrets() -> None:
    validate_runtime_settings(Settings(environment="development"))


def test_production_configuration_rejects_defaults() -> None:
    with pytest.raises(RuntimeError, match="生产配置校验失败") as exc_info:
        validate_runtime_settings(Settings(environment="production"))
    message = str(exc_info.value)
    assert "SESSION_SECRET" in message
    assert "BYOK_MASTER_KEY" in message
    assert "LANGGRAPH_AES_KEY" in message
    assert "COOKIE_SECURE" in message


def test_production_configuration_accepts_strong_separated_keys() -> None:
    validate_runtime_settings(
        Settings(
            environment="production",
            session_secret="s" * 40,
            byok_master_key="b" * 40,
            langgraph_aes_key=base64.b64encode(b"a" * 32).decode(),
            superadmin_password="admin-password",
            cookie_secure=True,
        )
    )
