"""多模型 BYOK 设置 API。

用户可保存多个加密 API Key/模型 Profile，并把辩论的各个 Agent 角色路由到不同 Profile。
响应只包含密钥掩码；所有写操作均校验 CSRF、属主和 endpoint SSRF 策略。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.auth import get_current_user, require_csrf
from app.core.crypto import decrypt_api_key, encrypt_api_key, mask_api_key
from app.db import get_session
from app.llm.context import DEBATE_AGENT_ROLES, LlmEndpointError, validate_endpoint
from app.models import LlmAgentRoute, LlmProfile, User

router = APIRouter(prefix="/api/v1", tags=["settings"])


class LlmProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=8, max_length=512)
    api_url: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=128)
    is_default: bool = False

    @field_validator("name", "api_key", "api_url", "model", mode="before")
    @classmethod
    def strip_strings(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class LlmProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    api_key: str | None = Field(default=None, min_length=8, max_length=512)
    api_url: str | None = Field(default=None, min_length=1, max_length=512)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    is_default: bool | None = None

    @field_validator("name", "api_key", "api_url", "model", mode="before")
    @classmethod
    def strip_strings(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class LlmProfileView(BaseModel):
    id: uuid.UUID
    name: str
    provider_host: str | None
    model: str
    key_hint: str
    key_status: Literal["valid", "invalid"]
    enabled: bool
    is_default: bool


class LlmRouteInput(BaseModel):
    role: str
    profile_id: uuid.UUID
    temperature: float = Field(default=0.3, ge=0, le=2)


class LlmRouteView(BaseModel):
    role: str
    profile_id: uuid.UUID
    temperature: float


class LlmSettingsView(BaseModel):
    profiles: list[LlmProfileView]
    routes: list[LlmRouteView]
    available_roles: list[str]


def _profile_view(profile: LlmProfile) -> LlmProfileView:
    try:
        key_hint = mask_api_key(decrypt_api_key(profile.api_key_ciphertext))
        key_status: Literal["valid", "invalid"] = "valid"
    except ValueError:
        key_hint = "不可用"
        key_status = "invalid"

    return LlmProfileView(
        id=profile.id,
        name=profile.name,
        provider_host=urlparse(profile.api_url).hostname,
        model=profile.model,
        key_hint=key_hint,
        key_status=key_status,
        enabled=profile.enabled,
        is_default=profile.is_default,
    )


def _owned_profile(session: Session, user_id: uuid.UUID, profile_id: uuid.UUID) -> LlmProfile:
    profile = session.execute(
        select(LlmProfile).where(LlmProfile.id == profile_id, LlmProfile.user_id == user_id)
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="llm_profile_not_found")
    return profile


def _validate_url(api_url: str) -> None:
    settings = get_settings()
    try:
        validate_endpoint(
            api_url,
            {host.strip() for host in settings.llm_allowed_hosts.split(",") if host.strip()},
            allow_local=settings.environment != "production",
        )
    except LlmEndpointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _set_default(session: Session, user_id: uuid.UUID, profile: LlmProfile) -> None:
    session.execute(update(LlmProfile).where(LlmProfile.user_id == user_id).values(is_default=False))
    profile.is_default = True
    profile.enabled = True


@router.get("/settings/llm", response_model=LlmSettingsView)
def get_llm_settings(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> LlmSettingsView:
    profiles = list(
        session.execute(
            select(LlmProfile).where(LlmProfile.user_id == user.id).order_by(LlmProfile.created_at, LlmProfile.name)
        ).scalars()
    )
    routes = list(
        session.execute(
            select(LlmAgentRoute)
            .where(LlmAgentRoute.user_id == user.id, LlmAgentRoute.purpose == "debate")
            .order_by(LlmAgentRoute.role)
        ).scalars()
    )
    return LlmSettingsView(
        profiles=[_profile_view(item) for item in profiles],
        routes=[
            LlmRouteView(role=item.role, profile_id=item.profile_id, temperature=item.temperature) for item in routes
        ],
        available_roles=list(DEBATE_AGENT_ROLES),
    )


@router.post(
    "/settings/llm/profiles",
    response_model=LlmProfileView,
    status_code=201,
    dependencies=[Depends(require_csrf)],
)
def create_llm_profile(
    body: LlmProfileCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> LlmProfileView:
    _validate_url(body.api_url)
    duplicate = session.execute(
        select(LlmProfile.id).where(LlmProfile.user_id == user.id, LlmProfile.name == body.name.strip())
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="llm_profile_name_exists")
    has_profile = session.execute(select(LlmProfile.id).where(LlmProfile.user_id == user.id)).first() is not None
    is_default = body.is_default or not has_profile
    if is_default:
        # PostgreSQL 的部分唯一索引要求任一时刻每个用户最多只有一个默认 Profile。
        # 新 Profile 尚未加入 Session，先清除旧默认，避免 flush 新记录时触发唯一约束。
        session.execute(update(LlmProfile).where(LlmProfile.user_id == user.id).values(is_default=False))
    now = datetime.now(UTC)
    profile = LlmProfile(
        id=uuid.uuid4(),
        user_id=user.id,
        name=body.name.strip(),
        api_key_ciphertext=encrypt_api_key(body.api_key),
        api_url=body.api_url.strip(),
        model=body.model.strip(),
        enabled=True,
        is_default=is_default,
        key_version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(profile)
    session.commit()
    return _profile_view(profile)


@router.patch(
    "/settings/llm/profiles/{profile_id}",
    response_model=LlmProfileView,
    dependencies=[Depends(require_csrf)],
)
def update_llm_profile(
    profile_id: uuid.UUID,
    body: LlmProfilePatch,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> LlmProfileView:
    profile = _owned_profile(session, user.id, profile_id)
    if body.api_url is not None:
        _validate_url(body.api_url)
        profile.api_url = body.api_url.strip()
    if body.name is not None:
        name = body.name.strip()
        duplicate = session.execute(
            select(LlmProfile.id).where(
                LlmProfile.user_id == user.id, LlmProfile.name == name, LlmProfile.id != profile.id
            )
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="llm_profile_name_exists")
        profile.name = name
    if body.api_key is not None:
        profile.api_key_ciphertext = encrypt_api_key(body.api_key)
        profile.key_version += 1
    if body.model is not None:
        profile.model = body.model.strip()
    if body.enabled is not None:
        if profile.is_default and not body.enabled:
            raise HTTPException(status_code=409, detail="default_profile_must_be_enabled")
        if (
            not body.enabled
            and session.execute(select(LlmAgentRoute.id).where(LlmAgentRoute.profile_id == profile.id)).first()
        ):
            raise HTTPException(status_code=409, detail="llm_profile_in_use")
        profile.enabled = body.enabled
    if body.is_default is True:
        _set_default(session, user.id, profile)
    profile.updated_at = datetime.now(UTC)
    session.commit()
    return _profile_view(profile)


@router.delete("/settings/llm/profiles/{profile_id}", dependencies=[Depends(require_csrf)])
def delete_llm_profile(
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    profile = _owned_profile(session, user.id, profile_id)
    was_default = profile.is_default
    session.delete(profile)
    session.flush()
    if was_default:
        replacement = session.execute(
            select(LlmProfile)
            .where(LlmProfile.user_id == user.id, LlmProfile.enabled.is_(True))
            .order_by(LlmProfile.created_at)
            .limit(1)
        ).scalar_one_or_none()
        if replacement is not None:
            replacement.is_default = True
    session.commit()
    return {"ok": True}


@router.put(
    "/settings/llm/routes",
    response_model=list[LlmRouteView],
    dependencies=[Depends(require_csrf)],
)
def put_llm_routes(
    body: list[LlmRouteInput],
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[LlmRouteView]:
    seen: set[str] = set()
    for item in body:
        if item.role not in DEBATE_AGENT_ROLES:
            raise HTTPException(status_code=400, detail=f"invalid_agent_role:{item.role}")
        if item.role in seen:
            raise HTTPException(status_code=400, detail=f"duplicate_agent_role:{item.role}")
        seen.add(item.role)
        profile = _owned_profile(session, user.id, item.profile_id)
        if not profile.enabled:
            raise HTTPException(status_code=409, detail=f"llm_profile_disabled:{profile.id}")

    session.execute(delete(LlmAgentRoute).where(LlmAgentRoute.user_id == user.id, LlmAgentRoute.purpose == "debate"))
    now = datetime.now(UTC)
    routes = [
        LlmAgentRoute(
            id=uuid.uuid4(),
            user_id=user.id,
            purpose="debate",
            role=item.role,
            profile_id=item.profile_id,
            temperature=item.temperature,
            created_at=now,
            updated_at=now,
        )
        for item in body
    ]
    session.add_all(routes)
    session.commit()
    return [LlmRouteView(role=item.role, profile_id=item.profile_id, temperature=item.temperature) for item in routes]
