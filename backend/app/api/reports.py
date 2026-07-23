"""报告只读 + 导入/删除/内容/可见性 API（方案 §3.4/§4.3/§11.3）。

只读：GET /reports、/reports/{id}（可见性 shared OR owner=self；合并个人态）。
内容：GET /reports/{id}/content（经鉴权流式返回 HTML，Caddy 不暴露 data/reports，ADR-019）。
导入：POST /reports/import（Import Token 代表超管身份 → owner=超管、private）。
删除：DELETE /reports/{id}（仅 owner=self）。
可见性：PATCH /reports/{id}/visibility（owner 切换 private ↔ shared）。
"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth import get_current_user, require_csrf
from app.core.authz import require_owner
from app.core.security import token_digest
from app.db import get_session
from app.models import Report, User, UserReportState, UserSession
from app.schemas.entities import OkResponse, ReportView
from app.services.report_lifecycle import delete_report, import_report
from app.services.report_store import read_report_file, report_file_exists

router = APIRouter(prefix="/api/v1", tags=["reports"])


def _to_view(
    report: Report,
    state: UserReportState | None,
    viewer_id: object,
    *,
    content_status: str | None = None,
) -> ReportView:
    return ReportView(
        id=report.id,
        visibility=report.visibility,
        title=report.title,
        topic=report.topic,
        type=report.type,
        type_label=report.type_label,
        summary=report.summary,
        origin=report.origin,
        local_date=report.local_date,
        tags=report.tags,
        highlights=report.highlights,
        content_status=content_status or report.content_status,
        created_at=report.created_at,
        is_owner=report.owner_id == viewer_id,
        starred=bool(state and state.starred),
        archived=bool(state and state.archived),
        read=bool(state and state.read_at is not None),
    )


@router.get("/reports", response_model=list[ReportView])
def list_reports(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[ReportView]:
    # 可见性：共享 OR 自有（方案 §4.3）
    reports = (
        session.execute(
            select(Report)
            .where(or_(Report.visibility == "shared", Report.owner_id == user.id))
            .order_by(Report.created_at.desc())
        )
        .scalars()
        .all()
    )
    states = {
        s.report_id: s
        for s in session.execute(select(UserReportState).where(UserReportState.user_id == user.id)).scalars().all()
    }
    # 内容缺失仍返回元数据和实时 content_status；GET 不产生数据库写入。
    return [
        _to_view(
            report,
            states.get(report.id),
            user.id,
            content_status="ok" if report_file_exists(report.file) else "missing",
        )
        for report in reports
    ]


def _visible_or_404(session: Session, report_id: str, user: User) -> Report:
    report = session.get(Report, report_id)
    # 私有且非自有 → 404（不泄露存在性，方案 §9.4）
    if report is None or (report.visibility != "shared" and report.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Not Found")
    return report


@router.get("/reports/{report_id}", response_model=ReportView)
def get_report(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ReportView:
    report = _visible_or_404(session, report_id, user)
    state = session.get(UserReportState, (user.id, report_id))
    return _to_view(
        report,
        state,
        user.id,
        content_status="ok" if report_file_exists(report.file) else "missing",
    )


@router.get("/reports/{report_id}/content", response_class=HTMLResponse)
def get_report_content(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> HTMLResponse:
    """经鉴权流式返回报告 HTML（ADR-019：Caddy 不直接暴露 data/reports）。"""
    report = _visible_or_404(session, report_id, user)
    html = read_report_file(report.file)
    if html is None:
        raise HTTPException(status_code=404, detail="报告内容缺失")
    return HTMLResponse(content=html)


def _resolve_import_owner(
    request: Request, x_import_token: str | None, fk_session: str | None, session: Session
) -> User:
    """导入身份解析：登录超管本人，或 Import Token（代表超管，§3.4）。否则 401。"""
    if fk_session:  # 已登录：必须是超管
        us = session.execute(
            select(UserSession).where(UserSession.token_hash == token_digest(fk_session))
        ).scalar_one_or_none()
        if us is not None and us.revoked_at is None and us.expires_at > datetime.now(UTC):
            user = session.get(User, us.user_id)
            if user is not None and user.role == "superadmin" and user.status == "active":
                return user
    token = x_import_token or ""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth[7:]
    settings = get_settings()
    if settings.import_token and hmac.compare_digest(token, settings.import_token):
        admin = session.execute(
            select(User).where(User.role == "superadmin", User.status == "active").order_by(User.created_at).limit(1)
        ).scalar_one_or_none()
        if admin is not None:
            return admin
    raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/reports/import", status_code=201)
def import_report_endpoint(
    body: dict[str, object],
    request: Request,
    x_import_token: str | None = Header(default=None),
    fk_session: str | None = Header(default=None, alias="Cookie"),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """外部导入报告（Import Token=超管身份，owner=超管、默认 private）。不吃 session gate。"""
    # Cookie 头里取 fk_session（导入端点不走标准 get_current_user 依赖）
    cookie_token = None
    if fk_session:
        for part in fk_session.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "fk_session":
                cookie_token = v
                break
    owner = _resolve_import_owner(request, x_import_token, cookie_token, session)
    try:
        report = import_report(session, owner, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "report": {
            "id": report.id,
            "title": report.title,
            "type": report.type,
            "summary": report.summary,
            "visibility": report.visibility,
        }
    }


@router.delete("/reports/{report_id}", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def delete_report_endpoint(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    """删报告（仅 owner=self；非属主/不存在 → 404）。"""
    report = session.get(Report, report_id)
    require_owner(report.owner_id if report else None, user.id)
    delete_report(session, report_id)
    return OkResponse()


# ---- 可见性切换 ----


class VisibilityRequest(BaseModel):
    visibility: str = Field(pattern="^(private|shared)$")


@router.patch(
    "/reports/{report_id}/visibility",
    response_model=OkResponse,
    dependencies=[Depends(require_csrf)],
)
def update_report_visibility(
    report_id: str,
    body: VisibilityRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OkResponse:
    """owner 切换报告可见性（private ↔ shared）。撤销共享后他人已有个人态静默失效（策略 A）。"""
    report = session.get(Report, report_id)
    require_owner(report.owner_id if report else None, user.id)
    assert report is not None
    report.visibility = body.visibility
    report.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()
