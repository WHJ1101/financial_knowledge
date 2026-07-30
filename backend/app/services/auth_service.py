"""认证服务（方案 §9.1/§9.2/§9.3）：登录建 session、邀请码注册、撤销。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    generate_token,
    hash_password,
    token_digest,
    verify_password,
)
from app.models import InviteCode, User, UserSession

SESSION_TTL = timedelta(days=7)


class AuthError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        self.code = code
        self.message = message
        self.status = status


def login(session: Session, username: str, password: str) -> tuple[User, str]:
    """校验密码，成功则建 DB session，返回 (user, 明文 token)。"""
    user = session.execute(select(User).where(User.username == username)).scalar_one_or_none()
    ok = verify_password(password, user.password_hash if user else None)
    if not user or not ok:
        raise AuthError("invalid_credentials", "用户名或密码错误", 401)
    if user.status != "active":
        raise AuthError("user_disabled", "用户已被禁用", 403)

    return user, issue_session(session, user)


def issue_session(session: Session, user: User) -> str:
    """为已完成身份校验的用户签发可撤销会话。"""
    token = generate_token()
    now = datetime.now(UTC)
    session.add(
        UserSession(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=token_digest(token),
            expires_at=now + SESSION_TTL,
            created_at=now,
            last_seen_at=now,
        )
    )
    session.commit()
    return token


def logout(session: Session, token: str) -> None:
    digest = token_digest(token)
    us = session.execute(select(UserSession).where(UserSession.token_hash == digest)).scalar_one_or_none()
    if us and us.revoked_at is None:
        us.revoked_at = datetime.now(UTC)
        session.commit()


def register_with_invite(session: Session, invite_code: str, username: str, password: str) -> User:
    """使用有效且未撤销的邀请码注册；邀请码在有效期内可重复使用。"""
    now = datetime.now(UTC)
    digest = token_digest(invite_code)

    if session.execute(select(User).where(User.username == username)).scalar_one_or_none():
        raise AuthError("username_taken", "用户名已被占用", 409)

    invite = session.execute(
        select(InviteCode).where(
            InviteCode.code_hash == digest,
            InviteCode.revoked_at.is_(None),
            InviteCode.expires_at > now,
        )
    ).scalar_one_or_none()
    if invite is None:
        raise AuthError("invalid_invite", "邀请码无效或已过期", 400)

    user = User(
        id=uuid.uuid4(),
        username=username,
        password_hash=hash_password(password),
        role="member",
        status="active",
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.commit()
    return user


def create_invite(session: Session, superadmin_id: uuid.UUID, ttl_hours: int, hint: str) -> tuple[InviteCode, str]:
    """超管生成邀请码。返回 (记录, 明文)；明文仅此一次可见。"""
    code = generate_token(24)
    now = datetime.now(UTC)
    invite = InviteCode(
        id=uuid.uuid4(),
        code_hash=token_digest(code),
        code_hint=hint or code[:6],
        created_by=superadmin_id,
        expires_at=now + timedelta(hours=ttl_hours),
        created_at=now,
    )
    session.add(invite)
    session.commit()
    return invite, code
