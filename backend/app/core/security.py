"""安全原语（方案 §9.1/§9.2）：argon2 密码、token 生成与 HMAC 摘要、CSRF 签名。"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import get_settings

_ph = PasswordHasher()
# 防用户名枚举：对不存在的用户也跑一次校验，抵消时间差（方案 §9.1）
_DUMMY_HASH = _ph.hash("dummy-password-for-timing-safety")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """校验密码。password_hash 为 None（用户不存在）时仍跑一次 dummy 校验再返回 False。"""
    if password_hash is None:
        with contextlib.suppress(VerifyMismatchError):
            _ph.verify(_DUMMY_HASH, password)
        return False
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def generate_token(nbytes: int = 32) -> str:
    """高熵随机 token（session / 邀请码明文）。"""
    return secrets.token_urlsafe(nbytes)


def token_digest(token: str) -> str:
    """token 的 HMAC-SHA256 摘要，用 SESSION_SECRET 作 key（方案 §9.1：DB 只存摘要）。"""
    secret = get_settings().session_secret.encode()
    return hmac.new(secret, token.encode(), hashlib.sha256).hexdigest()


# ---- CSRF token（double-submit，itsdangerous 签名，方案 §9.2）----

_CSRF_SALT = "fk-csrf-v1"


def _csrf_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt=_CSRF_SALT)


def issue_csrf_token() -> str:
    return _csrf_serializer().dumps(secrets.token_urlsafe(16))


def verify_csrf_token(token: str | None, max_age: int = 24 * 3600) -> bool:
    if not token:
        return False
    try:
        _csrf_serializer().loads(token, max_age=max_age)
        return True
    except BadSignature:
        return False
