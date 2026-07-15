"""认证与邀请码路由（方案 §3.4/§9）。"""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    get_current_user,
    require_csrf,
    require_superadmin,
)
from app.core.ratelimit import check_and_incr
from app.core.security import issue_csrf_token
from app.db import get_session
from app.models import InviteCode, User
from app.schemas.auth import (
    CsrfView,
    InviteCreateRequest,
    InviteView,
    LoginRequest,
    RegisterRequest,
    SessionView,
    UserView,
)
from app.services import auth_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/api/v1", tags=["auth"])


def _set_session_cookies(resp: Response, token: str) -> None:
    settings = get_settings()
    csrf = issue_csrf_token()
    resp.set_cookie(SESSION_COOKIE, token, httponly=True, secure=settings.cookie_secure,
                    samesite="lax", max_age=7 * 24 * 3600)
    # CSRF cookie 非 HttpOnly（前端需读取回填到 X-CSRF-Token 头，double-submit）
    resp.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=settings.cookie_secure,
                    samesite="lax", max_age=24 * 3600)


@router.get("/auth/csrf", response_model=CsrfView)
def get_csrf(response: Response) -> CsrfView:
    """匿名可取 CSRF token（登录/注册前，方案 §9.2）。"""
    settings = get_settings()
    token = issue_csrf_token()
    response.set_cookie(CSRF_COOKIE, token, httponly=False, secure=settings.cookie_secure, samesite="lax")
    return CsrfView(csrf_token=token)


@router.get("/auth/session", response_model=SessionView)
def get_session_status(
    fk_session: str | None = Cookie(default=None),
    session: Session = Depends(get_session),
) -> SessionView:
    if not fk_session:
        return SessionView(authenticated=False)
    try:
        from app.core.auth import get_current_user as _gcu

        user = _gcu(fk_session=fk_session, session=session)
        uv = UserView(username=user.username, role=user.role, status=user.status)
        return SessionView(authenticated=True, user=uv)
    except HTTPException:
        return SessionView(authenticated=False)


@router.post("/auth/login", response_model=SessionView, dependencies=[Depends(require_csrf)])
def login(body: LoginRequest, response: Response, session: Session = Depends(get_session)) -> SessionView:
    if not check_and_incr(session, "login", body.username):
        raise HTTPException(status_code=429, detail="尝试过于频繁，请稍后再试")
    try:
        user, token = auth_service.login(session, body.username, body.password)
    except AuthError as e:
        raise HTTPException(status_code=e.status, detail=e.message) from e
    _set_session_cookies(response, token)
    return SessionView(authenticated=True, user=UserView(username=user.username, role=user.role, status=user.status))


@router.post("/auth/logout", response_model=SessionView, dependencies=[Depends(require_csrf)])
def logout(response: Response, fk_session: str | None = Cookie(default=None),
           session: Session = Depends(get_session)) -> SessionView:
    if fk_session:
        auth_service.logout(session, fk_session)
    response.delete_cookie(SESSION_COOKIE)
    response.delete_cookie(CSRF_COOKIE)
    return SessionView(authenticated=False)


@router.post("/auth/register", response_model=SessionView, dependencies=[Depends(require_csrf)])
def register(body: RegisterRequest, response: Response, session: Session = Depends(get_session)) -> SessionView:
    if not check_and_incr(session, "register", body.username):
        raise HTTPException(status_code=429, detail="尝试过于频繁，请稍后再试")
    try:
        user = auth_service.register_with_invite(session, body.invite_code, body.username, body.password)
        _, token = auth_service.login(session, body.username, body.password)
    except AuthError as e:
        raise HTTPException(status_code=e.status, detail=e.message) from e
    _set_session_cookies(response, token)
    return SessionView(authenticated=True, user=UserView(username=user.username, role=user.role, status=user.status))


@router.get("/me", response_model=UserView)
def me(user: User = Depends(get_current_user)) -> UserView:
    return UserView(username=user.username, role=user.role, status=user.status)


@router.post("/invites", response_model=InviteView, dependencies=[Depends(require_csrf)])
def create_invite(body: InviteCreateRequest, admin: User = Depends(require_superadmin),
                  session: Session = Depends(get_session)) -> InviteView:
    invite, code = auth_service.create_invite(session, admin.id, body.ttl_hours, body.hint)
    return InviteView(code=code, code_hint=invite.code_hint, expires_at=invite.expires_at)


@router.get("/invites", response_model=list[InviteView])
def list_invites(_: User = Depends(require_superadmin), session: Session = Depends(get_session)) -> list[InviteView]:
    invites = session.execute(select(InviteCode).order_by(InviteCode.created_at.desc())).scalars().all()
    return [
        InviteView(code_hint=i.code_hint, expires_at=i.expires_at,
                   used_at=i.used_at, revoked_at=i.revoked_at)
        for i in invites
    ]
