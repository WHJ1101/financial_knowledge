"""报告只读 API（方案 §3.4/§4.3）。可见性：shared OR owner=self；合并个人态。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db import get_session
from app.models import Report, User, UserReportState
from app.schemas.entities import ReportView

router = APIRouter(prefix="/api/v1", tags=["reports"])


def _to_view(report: Report, state: UserReportState | None) -> ReportView:
    return ReportView(
        id=report.id, visibility=report.visibility, title=report.title, topic=report.topic,
        type=report.type, type_label=report.type_label, summary=report.summary, origin=report.origin,
        local_date=report.local_date, tags=report.tags, highlights=report.highlights,
        content_status=report.content_status, created_at=report.created_at,
        starred=bool(state and state.starred), archived=bool(state and state.archived),
        read=bool(state and state.read_at is not None),
    )


@router.get("/reports", response_model=list[ReportView])
def list_reports(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[ReportView]:
    # 可见性：共享 OR 自有（方案 §4.3）
    reports = session.execute(
        select(Report).where(or_(Report.visibility == "shared", Report.owner_id == user.id))
    ).scalars().all()
    states = {
        s.report_id: s
        for s in session.execute(
            select(UserReportState).where(UserReportState.user_id == user.id)
        ).scalars().all()
    }
    return [_to_view(r, states.get(r.id)) for r in reports]


@router.get("/reports/{report_id}", response_model=ReportView)
def get_report(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ReportView:
    report = session.get(Report, report_id)
    # 私有且非自有 → 404（不泄露存在性，方案 §9.4）
    if report is None or (report.visibility != "shared" and report.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Not Found")
    state = session.get(UserReportState, (user.id, report_id))
    return _to_view(report, state)
