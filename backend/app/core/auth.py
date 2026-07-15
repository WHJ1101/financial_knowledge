"""鉴权/授权依赖（方案 §9.1/§9.4）。

get_current_user：cookie token → 查 sessions → 查 users（拿最新 role/status，不信 cookie）。
require_superadmin：超管专属端点。
CSRF：写请求校验 Origin + X-CSRF-Token。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import token_digest, verify_csrf_token
from app.db import get_session
from app.models import User, UserSession

SESSION_COOKIE = "fk_session"
CSRF_COOKIE = "fk_csrf"


def get_current_user(
    fk_session: str | None = Cookie(default=None),
    session: Session = Depends(get_session),
) -> User:
    if not fk_session:
        raise HTTPException(status_code=401, detail="未登录")
    digest = token_digest(fk_session)
    now = datetime.now(UTC)
    us = session.execute(select(UserSession).where(UserSession.token_hash == digest)).scalar_one_or_none()
    if us is None or us.revoked_at is not None or us.expires_at < now:
        raise HTTPException(status_code=401, detail="会话无效或已过期")
    user = session.get(User, us.user_id)
    if user is None or user.status != "active":  # 禁用用户即时失效（方案 §9.1）
        raise HTTPException(status_code=401, detail="用户不可用")
    us.last_seen_at = now
    session.commit()
    return user


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != "superadmin":
        raise HTTPException(status_code=404, detail="Not Found")  # 不泄露端点存在性
    return user


def require_csrf(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
    fk_csrf: str | None = Cookie(default=None),
) -> None:
    """写请求 CSRF 校验（方案 §9.2）：Origin 合法 + X-CSRF-Token 与 cookie 一致且签名有效。"""
    settings = get_settings()
    origin = request.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        raise HTTPException(status_code=403, detail="Origin 不被允许")
    if not x_csrf_token or x_csrf_token != fk_csrf or not verify_csrf_token(x_csrf_token):
        raise HTTPException(status_code=403, detail="CSRF 校验失败")
