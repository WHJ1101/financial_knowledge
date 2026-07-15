"""用户体系：users / sessions / invite_codes / user_llm_configs（方案 §4.2）。

鉴权用数据库 session（可撤销，Review R6）；密码 argon2（argon2-cffi）；
邀请码存摘要、单次使用；BYOK key 加密存储（Fernet，方案 §9.6）。
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)  # argon2-cffi
    role: Mapped[str] = mapped_column(String(16))  # superadmin | member
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | disabled


class UserSession(Base):
    """数据库 session：cookie 只存随机 token，此处存其 HMAC 摘要（方案 §9.1）。"""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InviteCode(Base):
    """邀请码：仅超管生成，带过期 + 单次使用；存摘要，明文仅生成时展示一次（方案 §4.2/§9.3）。"""

    __tablename__ = "invite_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    code_hint: Mapped[str] = mapped_column(String(32))  # 便于超管辨识
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserLlmConfig(Base, TimestampMixin):
    """BYOK：每用户 LLM 配置。api_key_ciphertext 为 Fernet 密文，绝不明文（方案 §9.6）。"""

    __tablename__ = "user_llm_configs"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    api_key_ciphertext: Mapped[str] = mapped_column(Text)
    api_url: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(128))
    key_version: Mapped[int] = mapped_column(Integer, default=1)  # 预留轮换（方案 §16）


class RateLimitBucket(Base):
    """限流固定窗口：仅 login/register/invite_verify 三个防爆破点（方案 §4.5/§16）。"""

    __tablename__ = "rate_limit_buckets"

    key_hash: Mapped[str] = mapped_column(String(128), primary_key=True)
    action: Mapped[str] = mapped_column(String(32), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
