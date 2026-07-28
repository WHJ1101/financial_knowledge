"""报告写操作 API（方案 §3.4/§4.3）：标星/归档/已读（个人态）+ publish（超管）。

个人态只写 user_report_states，不回写 reports（方案 §4.3）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.models import Report, User, UserReportState
from app.schemas.entities import OkResponse

router = APIRouter(prefix="/api/v1", tags=["reports"])


def _get_or_create_state(session: Session, user_id: uuid.UUID, report_id: str) -> UserReportState:
    state = session.get(UserReportState, (user_id, report_id))
    if state is None:
        state = UserReportState(user_id=user_id, report_id=report_id, updated_at=datetime.now(UTC))
        session.add(state)
    return state


def _assert_visible(session: Session, report_id: str, user: User) -> Report:
    report = session.get(Report, report_id)
    if report is None or (report.visibility != "shared" and report.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Not Found")
    return report


def _upsert_read_state(session: Session, user_id: uuid.UUID, report_id: str) -> None:
    now = datetime.now(UTC)
    statement = (
        insert(UserReportState)
        .values(
            user_id=user_id,
            report_id=report_id,
            read_at=now,
            starred=False,
            archived=False,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[UserReportState.user_id, UserReportState.report_id],
            set_={"read_at": now, "updated_at": now},
        )
    )
    session.execute(statement)


@router.post("/reports/{report_id}/read", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def mark_read(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    _assert_visible(session, report_id, user)
    _upsert_read_state(session, user.id, report_id)
    session.commit()
    return OkResponse()


@router.post("/reports/{report_id}/star", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def toggle_star(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    _assert_visible(session, report_id, user)
    state = _get_or_create_state(session, user.id, report_id)
    state.starred = not state.starred
    state.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()


@router.post("/reports/{report_id}/archive", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def toggle_archive(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> OkResponse:
    _assert_visible(session, report_id, user)
    state = _get_or_create_state(session, user.id, report_id)
    state.archived = not state.archived
    state.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()


@router.post("/reports/{report_id}/publish", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def publish_report(
    report_id: str, _: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> OkResponse:
    """private → shared，仅超管（方案 §3.4）。"""
    report = session.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Not Found")
    report.visibility = "shared"
    report.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()
