"""LLM 客户端与 BYOK 解析（方案 §9.5/§9.7）。

resolve_llm_config：由 execution_owner_id 查 user_llm_configs → 解密 → SSRF 校验。
未配置 → LlmUnavailable（不回退全局 key）。
build_chat_client：langchain-openai ChatOpenAI 封装，指向用户自己的 endpoint。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_api_key
from app.llm.context import (
    LlmExecutionContext,
    LlmUnavailable,
    ResolvedLlmConfig,
    validate_endpoint,
)
from app.models import UserLlmConfig


def resolve_llm_config(session: Session, ctx: LlmExecutionContext) -> ResolvedLlmConfig:
    """解析执行身份的 BYOK 配置。未配置 → LlmUnavailable（方案 §9.5）。"""
    cfg = session.execute(
        select(UserLlmConfig).where(UserLlmConfig.user_id == uuid.UUID(ctx.execution_owner_id))
    ).scalar_one_or_none()
    if cfg is None:
        raise LlmUnavailable(f"用户 {ctx.execution_owner_id} 未配置 LLM Key")
    validate_endpoint(cfg.api_url)  # SSRF 校验（§9.7）
    return ResolvedLlmConfig(
        api_key=decrypt_api_key(cfg.api_key_ciphertext), api_url=cfg.api_url, model=cfg.model
    )


class LangchainChatClient:
    """langchain-openai ChatOpenAI 封装，用用户 BYOK 配置构造（方案 §7.5）。

    提供同步 complete_sync：worker task 是同步 def、LangGraph invoke 也同步，全链路同步最简。
    """

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
            model=self._config.model, api_key=SecretStr(self._config.api_key),
            base_url=base or None, temperature=temperature, timeout=60, max_retries=1,
        )

    def complete_sync(self, messages: list[dict[str, str]], temperature: float = 0.3) -> str:
        resp = self._model(temperature).invoke(messages)
        return str(resp.content)

    async def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        resp = await self._model(kwargs.get("temperature", 0.3)).ainvoke(messages)
        return str(resp.content)
