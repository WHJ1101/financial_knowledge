"""用户体系：users / sessions / invite_codes / llm_profiles / llm_agent_routes。

鉴权用数据库 session（可撤销，Review R6）；密码 argon2（argon2-cffi）；
邀请码存摘要、有效期内可重复使用；BYOK key 加密存储（Fernet，方案 §9.6）。
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
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
    """邀请码：仅超管生成，有效期内可重复使用；存摘要，明文仅生成时展示一次（方案 §4.2/§9.3）。"""

    __tablename__ = "invite_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    code_hint: Mapped[str] = mapped_column(String(32))  # 便于超管辨识
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LlmProfile(Base, TimestampMixin):
    """一个可复用的 BYOK 模型配置；同一用户可保存多个 API Key/模型。"""

    __tablename__ = "llm_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_llm_profile_user_name"),
        Index(
            "uq_llm_profiles_one_default_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    api_key_ciphertext: Mapped[str] = mapped_column(Text)
    api_url: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    key_version: Mapped[int] = mapped_column(Integer, default=1)  # 预留轮换（方案 §16）


class LlmAgentRoute(Base, TimestampMixin):
    """把一个用途/Agent 角色路由到某个模型配置。未配置的角色使用默认配置。"""

    __tablename__ = "llm_agent_routes"
    __table_args__ = (UniqueConstraint("user_id", "purpose", "role", name="uq_llm_route_user_purpose_role"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(32))
    role: Mapped[str] = mapped_column(String(32))
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("llm_profiles.id", ondelete="CASCADE"), index=True)
    temperature: Mapped[float] = mapped_column(Float, default=0.3)


class RateLimitBucket(Base):
    """限流固定窗口：仅 login/register/invite_verify 三个防爆破点（方案 §4.5/§16）。"""

    __tablename__ = "rate_limit_buckets"

    key_hash: Mapped[str] = mapped_column(String(128), primary_key=True)
    action: Mapped[str] = mapped_column(String(32), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
