"""信号读取、个人处理态与异步飞书同步运行 API。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.models import CommunitySignal, SourceSyncRun, User, UserSignalState
from app.repositories.scoping import scoped_select
from app.schemas.entities import OkResponse
from app.services.research_data_hub.source_operations import fingerprint
from app.services.run_lifecycle import create_source_sync_run, source_sync_run_view

router = APIRouter(prefix="/api/v1", tags=["signals"])


class SignalView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    date: str
    source: str
    source_title: str | None = None
    source_url: str | None = None
    theme: str | None
    industry: str | None
    related_assets: list[str] = Field(default_factory=list)
    summary: str | None
    evidence: str | None = None
    signal_type: str | None
    confidence: str = "medium"
    verification_status: str = "待验证"
    importance: int
    state: str = "unread"  # 个人态
    version_no: int = 1


class SignalStateRequest(BaseModel):
    state: str = Field(pattern="^(unread|confirmed|ignored)$")


@router.get("/signals", response_model=list[SignalView])
def list_signals(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[SignalView]:
    # 公共信号（所有登录用户可读）+ 合并本人个人态（方案 §4.4）
    signals = (
        session.execute(
            select(CommunitySignal)
            .where(CommunitySignal.active.is_(True))
            .order_by(CommunitySignal.date.desc(), CommunitySignal.importance.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    states = {
        s.signal_id: s.state
        for s in session.execute(scoped_select(UserSignalState, user.id)).scalars().all()
    }
    return [
        SignalView(
            id=s.id,
            date=s.date,
            source=s.source,
            source_title=s.source_title,
            source_url=s.source_url,
            theme=s.theme,
            industry=s.industry,
            related_assets=[str(x) for x in (s.related_assets or [])],
            summary=s.summary,
            evidence=s.evidence,
            signal_type=s.signal_type,
            confidence=s.confidence,
            verification_status=s.verification_status,
            importance=s.importance,
            state=states.get(s.id, "unread"),
            version_no=s.version_no,
        )
        for s in signals
    ]


@router.post("/signals/{signal_id}/state", response_model=OkResponse, dependencies=[Depends(require_csrf)])
def set_signal_state(
    signal_id: str,
    body: SignalStateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OkResponse:
    signal = session.get(CommunitySignal, signal_id)
    if signal is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "signal_not_found", "message": "信号不存在"},
        )
    if not signal.active:
        raise HTTPException(
            status_code=409,
            detail={"code": "signal_superseded", "message": "信号已产生新版本，请刷新后处理"},
        )
    # 只写本人 user_signal_states，不动公共信号本体。
    st = session.execute(
        scoped_select(UserSignalState, user.id).where(UserSignalState.signal_id == signal_id)
    ).scalar_one_or_none()
    if st is None:
        st = UserSignalState(user_id=user.id, signal_id=signal_id, state=body.state, updated_at=datetime.now(UTC))
        session.add(st)
    else:
        st.state = body.state
        st.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()


class SignalSyncRequest(BaseModel):
    mode: str = Field(default="incremental", pattern="^(incremental|backfill)$")
    date_from: date | None = None
    date_to: date | None = None

    @model_validator(mode="after")
    def validate_range(self) -> SignalSyncRequest:
        if self.mode == "backfill" and (self.date_from is None or self.date_to is None):
            raise ValueError("backfill requires date_from and date_to")
        if self.date_from and self.date_to:
            if self.date_from > self.date_to:
                raise ValueError("date_from must be before date_to")
            if self.date_to - self.date_from > timedelta(days=89):
                raise ValueError("backfill range cannot exceed 90 days")
        return self


def _enqueue_signal_sync(
    session: Session,
    *,
    admin: User,
    body: SignalSyncRequest,
    trigger: str = "manual",
) -> SourceSyncRun:
    request = body.model_dump(mode="json")
    request_fingerprint = fingerprint(request)
    idempotency_key = (
        f"feishu.signal:{body.mode}:{body.date_from or '-'}:{body.date_to or '-'}:{request_fingerprint}"
    )
    run = create_source_sync_run(
        session,
        source_key="feishu.signal",
        capability_key="signal.feishu.sections",
        trigger=trigger,
        request_fingerprint=request_fingerprint,
        idempotency_key=idempotency_key,
        range_start=body.date_from,
        range_end=body.date_to,
    )
    from app.queue import procrastinate_app

    task = procrastinate_app.tasks["fk:sync_feishu_signal_source"]
    run.queue_job_id = task.configure(connection=session.connection()).defer(
        run_id=str(run.id),
        execution_owner_id=str(admin.id),
    )
    session.flush()
    return run


@router.post("/signals/sync-runs", status_code=202, dependencies=[Depends(require_csrf)])
def enqueue_signal_sync(
    body: SignalSyncRequest,
    admin: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    try:
        run = _enqueue_signal_sync(session, admin=admin, body=body)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "active_run_exists", "message": "相同范围的飞书同步正在执行"},
        ) from exc
    except Exception as exc:
        session.rollback()
        raise HTTPException(
            status_code=503,
            detail={"code": "queue_defer_failed", "message": "飞书同步入队失败"},
        ) from exc
    return {
        "run_id": str(run.id),
        "status": run.status,
        "poll_url": f"/api/v1/signals/sync-runs/{run.id}",
    }


def _signal_run(session: Session, run_id: uuid.UUID) -> SourceSyncRun:
    run = session.get(SourceSyncRun, run_id)
    if run is None or run.source_key != "feishu.signal":
        raise HTTPException(
            status_code=404,
            detail={"code": "run_not_found", "message": "飞书同步运行不存在"},
        )
    return run


@router.get("/signals/sync-runs/latest")
def latest_signal_sync(
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, object] | None:
    run = session.execute(
        select(SourceSyncRun)
        .where(SourceSyncRun.source_key == "feishu.signal")
        .order_by(SourceSyncRun.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return source_sync_run_view(run) if run else None


@router.get("/signals/sync-runs/{run_id}")
def get_signal_sync(
    run_id: uuid.UUID,
    _: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    return source_sync_run_view(_signal_run(session, run_id))


@router.post(
    "/signals/sync-runs/{run_id}/retry",
    status_code=202,
    dependencies=[Depends(require_csrf)],
)
def retry_signal_sync(
    run_id: uuid.UUID,
    admin: User = Depends(require_superadmin),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    previous = _signal_run(session, run_id)
    if previous.status not in {"partial", "failed"}:
        raise HTTPException(
            status_code=409,
            detail={"code": "run_not_retryable", "message": "该运行没有可重试失败"},
        )
    failure_dates = [
        date.fromisoformat(item)
        for item in (previous.result_summary or {}).get("failure_dates", [])
    ]
    body = SignalSyncRequest(
        mode="backfill" if failure_dates else "incremental",
        date_from=min(failure_dates) if failure_dates else None,
        date_to=max(failure_dates) if failure_dates else None,
    )
    try:
        run = _enqueue_signal_sync(session, admin=admin, body=body, trigger="retry")
        session.commit()
    except Exception as exc:
        session.rollback()
        raise HTTPException(
            status_code=503,
            detail={"code": "queue_defer_failed", "message": "飞书重试入队失败"},
        ) from exc
    return {
        "run_id": str(run.id),
        "status": run.status,
        "poll_url": f"/api/v1/signals/sync-runs/{run.id}",
    }
