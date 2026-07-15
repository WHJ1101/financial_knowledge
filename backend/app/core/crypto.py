"""BYOK 加密（方案 §9.6，安全红线）。

用户 LLM key 用 Fernet 对称加密落库；密钥由 BYOK_MASTER_KEY 经 KDF 派生。
key 绝不明文出现在日志/回显/报告（§9.6）。掩码工具供前端回显用。
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _fernet() -> Fernet:
    """由 BYOK_MASTER_KEY 派生 32 字节 Fernet 密钥（urlsafe base64）。"""
    master = get_settings().byok_master_key.encode()
    digest = hashlib.sha256(master).digest()  # 32 字节
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_api_key(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("BYOK 密文无法解密（主密钥可能已变更）") from e


def mask_api_key(plaintext: str) -> str:
    """掩码回显：sk-****abcd（方案 §9.6，只给前端看这个）。"""
    if len(plaintext) <= 8:
        return "****"
    return f"{plaintext[:3]}****{plaintext[-4:]}"
