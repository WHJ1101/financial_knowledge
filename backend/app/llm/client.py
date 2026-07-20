"""LLM 客户端、多 Profile 解析与 Agent 角色路由。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.crypto import decrypt_api_key
from app.llm.context import (
    DEBATE_AGENT_ROLES,
    AgentRole,
    LlmExecutionContext,
    LlmUnavailable,
    Purpose,
    ResolvedLlmConfig,
    validate_endpoint,
)
from app.models import LlmAgentRoute, LlmProfile

ChatFn = Callable[[str, str], str]


def resolve_llm_config(
    session: Session,
    ctx: LlmExecutionContext,
    role: AgentRole | None = None,
) -> ResolvedLlmConfig:
    """按 execution_owner + purpose + role 解析配置；未配置角色使用该用户默认 Profile。"""
    owner_id = uuid.UUID(ctx.execution_owner_id)
    profile: LlmProfile | None = None
    temperature = 0.3
    if role is not None:
        route_row = session.execute(
            select(LlmAgentRoute, LlmProfile)
            .join(LlmProfile, LlmProfile.id == LlmAgentRoute.profile_id)
            .where(
                LlmAgentRoute.user_id == owner_id,
                LlmAgentRoute.purpose == ctx.purpose,
                LlmAgentRoute.role == role,
                LlmProfile.user_id == owner_id,
                LlmProfile.enabled.is_(True),
            )
        ).first()
        if route_row is not None:
            route, profile = route_row
            temperature = route.temperature
    if profile is None:
        profile = session.execute(
            select(LlmProfile)
            .where(
                LlmProfile.user_id == owner_id,
                LlmProfile.enabled.is_(True),
                LlmProfile.is_default.is_(True),
            )
            .limit(1)
        ).scalar_one_or_none()
    if profile is None:
        raise LlmUnavailable(f"用户 {ctx.execution_owner_id} 未配置可用的默认 LLM Profile")
    settings = get_settings()
    validate_endpoint(
        profile.api_url,
        {host.strip() for host in settings.llm_allowed_hosts.split(",") if host.strip()},
        allow_local=settings.environment != "production",
    )
    return ResolvedLlmConfig(
        api_key=decrypt_api_key(profile.api_key_ciphertext),
        api_url=profile.api_url,
        model=profile.model,
        profile_id=str(profile.id),
        profile_name=profile.name,
        temperature=temperature,
    )


class LangchainChatClient:
    """OpenAI-compatible 同步/异步客户端；每次调用使用不可变 Profile 快照。"""

    def __init__(self, config: ResolvedLlmConfig) -> None:
        self._config = config

    def _model(self, temperature: float) -> Any:
        from langchain_openai import ChatOpenAI
        from pydantic import SecretStr

        base = self._config.api_url.rstrip("/")
        for suffix in ("/chat/completions", "/v1/chat/completions"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                break
        return ChatOpenAI(
            model=self._config.model,
            api_key=SecretStr(self._config.api_key),
            base_url=base or None,
            temperature=temperature,
            timeout=60,
            max_retries=1,
        )

    def complete_sync(self, messages: list[dict[str, str]], temperature: float | None = None) -> str:
        resp = self._model(self._config.temperature if temperature is None else temperature).invoke(messages)
        return str(resp.content)

    async def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        temperature = kwargs.get("temperature", self._config.temperature)
        resp = await self._model(temperature).ainvoke(messages)
        return str(resp.content)


def _chat_for(config: ResolvedLlmConfig) -> ChatFn:
    client = LangchainChatClient(config)

    def chat(system: str, user: str) -> str:
        return client.complete_sync([{"role": "system", "content": system}, {"role": "user", "content": user}])

    return chat


class RoleChatRouter:
    """辩论运行期的角色→模型路由；所有密钥只保留在 worker 内存。"""

    def __init__(self, configs: dict[AgentRole, ResolvedLlmConfig]) -> None:
        self._configs = configs
        self._chats = {role: _chat_for(config) for role, config in configs.items()}

    def for_role(self, role: AgentRole) -> ChatFn:
        return self._chats[role]

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return {
            role: {
                "profile_id": config.profile_id,
                "profile_name": config.profile_name,
                "model": config.model,
                "provider_host": _provider_host(config.api_url),
                "temperature": config.temperature,
            }
            for role, config in self._configs.items()
        }


def _provider_host(api_url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(api_url).hostname or ""


def make_role_chat_router(
    session: Session,
    execution_owner_id: str,
    purpose: Purpose,
    run_id: str,
) -> RoleChatRouter:
    ctx = LlmExecutionContext(execution_owner_id=execution_owner_id, purpose=purpose, run_id=run_id)
    return RoleChatRouter({role: resolve_llm_config(session, ctx, role) for role in DEBATE_AGENT_ROLES})


def make_sync_chat(session: Session, execution_owner_id: str, purpose: Purpose, run_id: str) -> ChatFn:
    """非辩论场景使用默认 Profile。"""
    ctx = LlmExecutionContext(execution_owner_id=execution_owner_id, purpose=purpose, run_id=run_id)
    return _chat_for(resolve_llm_config(session, ctx))


def try_make_sync_chat(
    session: Session, execution_owner_id: str, purpose: Purpose, run_id: str
) -> tuple[ChatFn | None, str]:
    try:
        ctx = LlmExecutionContext(execution_owner_id=execution_owner_id, purpose=purpose, run_id=run_id)
        config = resolve_llm_config(session, ctx)
    except LlmUnavailable:
        return None, ""
    return _chat_for(config), config.model
