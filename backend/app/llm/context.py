"""LLM 执行上下文与 Provider（方案 §9.5/§9.7，Review R3）。

所有 LLM 调用必须带 LlmExecutionContext（决定用谁的 BYOK key）。
无执行身份或其未配 key → LlmUnavailable，绝不回退全局 key。
URL 经 LlmEndpointPolicy 校验防 SSRF（§9.7）。
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlparse

Purpose = Literal[
    "research", "stock_analysis", "position_analysis", "signal_extraction", "debate", "scheduled_briefing"
]

AgentRole = Literal["technical", "fundamental", "macro", "sentiment", "bull", "bear", "judge", "risk"]


@dataclass(frozen=True)
class LlmExecutionContext:
    execution_owner_id: str  # 用谁的 BYOK key
    purpose: Purpose
    run_id: str
    request_actor_id: str | None = None


class LlmUnavailable(Exception):
    """执行身份未配 key 或不可用（方案 §9.5：不回退全局 key）。"""


class LlmEndpointError(Exception):
    """URL 未通过 SSRF 策略（方案 §9.7）。"""


# 默认 allowlist（方案 §9.7）；自定义域名需超管在系统配置放行
_DEFAULT_ALLOWED_HOSTS = {
    "api.openai.com",
    "openrouter.ai",
    "api.deepseek.com",
    "api.anthropic.com",
    "dashscope.aliyuncs.com",
    "ark.cn-beijing.volces.com",
}


def validate_endpoint(
    api_url: str,
    extra_allowed: set[str] | None = None,
    *,
    allow_local: bool = False,
) -> None:
    """SSRF 校验（方案 §9.7）：https、禁私有/回环 IP、host allowlist。"""
    parsed = urlparse(api_url)
    # 开发允许显式 http://localhost；其余仅 https
    local_hosts = ("localhost", "127.0.0.1")
    _dev_local = allow_local and parsed.scheme == "http" and parsed.hostname in local_hosts
    if parsed.scheme != "https" and not _dev_local:
        raise LlmEndpointError(f"仅允许 https: {api_url}")
    host = parsed.hostname
    if not host:
        raise LlmEndpointError("URL 无 host")

    allowed = _DEFAULT_ALLOWED_HOSTS | (extra_allowed or set())
    if host not in allowed and not (allow_local and host in local_hosts):
        raise LlmEndpointError(f"host 不在 allowlist: {host}")

    # DNS 解析后校验 IP，禁回环/私有/链路本地/元数据
    try:
        for res in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(res[4][0])
            is_internal = ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            if is_internal and not (allow_local and host in local_hosts):
                raise LlmEndpointError(f"解析到内网 IP，拒绝: {ip}")
    except socket.gaierror:
        raise LlmEndpointError(f"DNS 解析失败: {host}") from None


@dataclass(frozen=True)
class ResolvedLlmConfig:
    """从 BYOK 解密得到的运行时配置（仅驻内存，方案 §9.6）。"""

    api_key: str
    api_url: str
    model: str
    profile_id: str
    profile_name: str
    temperature: float = 0.3


class ChatClient(Protocol):
    async def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str: ...
