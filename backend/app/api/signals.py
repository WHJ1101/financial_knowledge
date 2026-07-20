"""信号源 API（方案 §3.4/§4.4/§11.5）。信号本体公共只读；确认/忽略走用户态表 user_signal_states。

POST /signals/sync：超管从飞书社群源同步信号（BYOK 抽取，逐天覆盖落库）。飞书未配 → skipped。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_superadmin
from app.db import get_session
from app.models import CommunitySignal, User, UserSignalState
from app.schemas.entities import OkResponse

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


class SignalStateRequest(BaseModel):
    state: str = Field(pattern="^(unread|confirmed|ignored)$")


@router.get("/signals", response_model=list[SignalView])
def list_signals(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[SignalView]:
    # 公共信号（所有登录用户可读）+ 合并本人个人态（方案 §4.4）
    signals = session.execute(select(CommunitySignal).order_by(CommunitySignal.date.desc()).limit(200)).scalars().all()
    states = {
        s.signal_id: s.state
        for s in session.execute(select(UserSignalState).where(UserSignalState.user_id == user.id)).scalars().all()
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
    # 只写本人 user_signal_states，不动公共信号本体（方案 §4.4/ADR-024）
    st = session.get(UserSignalState, (user.id, signal_id))
    if st is None:
        st = UserSignalState(user_id=user.id, signal_id=signal_id, state=body.state, updated_at=datetime.now(UTC))
        session.add(st)
    else:
        st.state = body.state
        st.updated_at = datetime.now(UTC)
    session.commit()
    return OkResponse()


class SignalSyncResult(BaseModel):
    ok: bool
    skipped: bool = False
    reason: str = ""
    written: int = 0
    processed_dates: list[str] = Field(default_factory=list)


@router.post("/signals/sync", response_model=SignalSyncResult, dependencies=[Depends(require_csrf)])
def sync_signals(
    admin: User = Depends(require_superadmin), session: Session = Depends(get_session)
) -> SignalSyncResult:
    """从飞书社群源同步信号（超管，BYOK 抽取）。飞书未配 → skipped（方案 §11.5/§11.10）。"""
    from app.services.signal_sync import sync_feishu_signals

    result = sync_feishu_signals(session, str(admin.id))
    return SignalSyncResult(**result)
