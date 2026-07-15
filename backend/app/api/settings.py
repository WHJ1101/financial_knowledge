"""BYOK 设置 API（方案 §3.4/§9.6）。key 加密落库，回显仅掩码。"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf
from app.core.crypto import decrypt_api_key, encrypt_api_key, mask_api_key
from app.db import get_session
from app.llm.context import LlmEndpointError, validate_endpoint
from app.models import User, UserLlmConfig

router = APIRouter(prefix="/api/v1", tags=["settings"])


class LlmConfigRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)
    api_url: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=128)


class LlmConfigView(BaseModel):
    configured: bool
    provider_host: str | None = None
    model: str | None = None
    key_hint: str | None = None  # 掩码，绝不返回明文/密文（方案 §9.6）


@router.get("/settings/llm", response_model=LlmConfigView)
def get_llm_config(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> LlmConfigView:
    cfg = session.get(UserLlmConfig, user.id)
    if cfg is None:
        return LlmConfigView(configured=False)
    return LlmConfigView(
        configured=True,
        provider_host=urlparse(cfg.api_url).hostname,
        model=cfg.model,
        key_hint=mask_api_key(decrypt_api_key(cfg.api_key_ciphertext)),
    )


@router.put("/settings/llm", response_model=LlmConfigView, dependencies=[Depends(require_csrf)])
def put_llm_config(
    body: LlmConfigRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> LlmConfigView:
    try:
        validate_endpoint(body.api_url)  # SSRF 校验（§9.7）
    except LlmEndpointError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    cfg = session.get(UserLlmConfig, user.id)
    if cfg is None:
        cfg = UserLlmConfig(user_id=user.id, api_key_ciphertext="", api_url="", model="", key_version=1)
        session.add(cfg)
    cfg.api_key_ciphertext = encrypt_api_key(body.api_key)
    cfg.api_url = body.api_url
    cfg.model = body.model
    session.commit()
    return LlmConfigView(
        configured=True, provider_host=urlparse(body.api_url).hostname,
        model=body.model, key_hint=mask_api_key(body.api_key),
    )


@router.delete("/settings/llm", dependencies=[Depends(require_csrf)])
def delete_llm_config(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, bool]:
    session.execute(delete(UserLlmConfig).where(UserLlmConfig.user_id == user.id))
    session.commit()
    return {"ok": True}
