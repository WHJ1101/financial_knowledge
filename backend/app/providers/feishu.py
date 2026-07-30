"""飞书集成 Provider（移植 lib/feishu{Client,Bot,Webhook}.js，方案 §11.10，ADR-011）。

- tenant_access_token 获取（进程级缓存）+ 通用 JSON 请求。
- 应用机器人发消息（im/v1/messages）与自定义机器人 webhook（含 HMAC 签名）两通道。
- 告警/摘要卡片构造 + 通道选择（webhook > app-bot）。
配置全部走环境变量（FEISHU_*）；未配置静默跳过；发送异常吞掉记日志，不阻断主流程。
★真实发送到群前需用户确认（凭证已在 .env，端到端由调用方在确认后触发）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

FEISHU_BASE = "https://open.feishu.cn"
_TIMEOUT = 10.0
_TOKEN_TTL = 7200
_REFRESH_BUFFER = 300

# 进程级 token 缓存 {app_id: (token, expires_at_ms)}
_token_cache: dict[str, tuple[str, float]] = {}
_REPOSITORY_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class _FeishuSettings(BaseSettings):
    """Read process variables in production and the repository .env in local development."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    app_id: str = Field(default="", validation_alias="FEISHU_APP_ID")
    app_secret: str = Field(default="", validation_alias="FEISHU_APP_SECRET")
    webhook_url: str = Field(default="", validation_alias="FEISHU_WEBHOOK_URL")
    webhook_secret: str = Field(default="", validation_alias="FEISHU_WEBHOOK_SECRET")
    push_chat_id: str = Field(default="", validation_alias="FEISHU_PUSH_CHAT_ID")
    push_open_id: str = Field(default="", validation_alias="FEISHU_PUSH_OPEN_ID")
    push_user_id: str = Field(default="", validation_alias="FEISHU_PUSH_USER_ID")
    push_email: str = Field(default="", validation_alias="FEISHU_PUSH_EMAIL")
    signal_wiki_url: str = Field(default="", validation_alias="FEISHU_SIGNAL_WIKI_URL")
    signal_url: str = Field(default="", validation_alias="FEISHU_SIGNAL_URL")


def _feishu_env() -> dict[str, str]:
    """飞书相关配置；测试隔离真实 .env，生产优先使用容器环境。"""
    env_file = None if os.environ.get("FINANCE_KNOWLEDGE_ENVIRONMENT") == "test" else _REPOSITORY_ENV_FILE
    settings = _FeishuSettings(_env_file=env_file)
    return {
        "FEISHU_APP_ID": settings.app_id,
        "FEISHU_APP_SECRET": settings.app_secret,
        "FEISHU_WEBHOOK_URL": settings.webhook_url,
        "FEISHU_WEBHOOK_SECRET": settings.webhook_secret,
        "FEISHU_PUSH_CHAT_ID": settings.push_chat_id,
        "FEISHU_PUSH_OPEN_ID": settings.push_open_id,
        "FEISHU_PUSH_USER_ID": settings.push_user_id,
        "FEISHU_PUSH_EMAIL": settings.push_email,
        "FEISHU_SIGNAL_WIKI_URL": settings.signal_wiki_url,
        "FEISHU_SIGNAL_URL": settings.signal_url,
    }


def signal_source_url() -> str:
    env = _feishu_env()
    return env["FEISHU_SIGNAL_WIKI_URL"] or env["FEISHU_SIGNAL_URL"]


def is_feishu_configured() -> bool:
    env = _feishu_env()
    return bool(env["FEISHU_APP_ID"] and env["FEISHU_APP_SECRET"])


def is_webhook_configured() -> bool:
    return bool(_feishu_env()["FEISHU_WEBHOOK_URL"])


def _resolve_receiver() -> tuple[str, str] | None:
    """接收方优先级：chat_id > open_id > user_id > email。返回 (type, id)。"""
    env = _feishu_env()
    for typ, key in (
        ("chat_id", "FEISHU_PUSH_CHAT_ID"),
        ("open_id", "FEISHU_PUSH_OPEN_ID"),
        ("user_id", "FEISHU_PUSH_USER_ID"),
        ("email", "FEISHU_PUSH_EMAIL"),
    ):
        if env[key]:
            return typ, env[key]
    return None


def is_push_configured() -> bool:
    return is_feishu_configured() and _resolve_receiver() is not None


def integration_status() -> dict[str, Any]:
    """只返回配置完整度与脱敏目标提示。"""
    env = _feishu_env()
    receiver = _resolve_receiver()
    if env["FEISHU_WEBHOOK_URL"]:
        host = urlsplit(env["FEISHU_WEBHOOK_URL"]).netloc
        target_hint = f"webhook@{host}" if host else "webhook"
    elif receiver:
        target_hint = f"{receiver[0]}:…{receiver[1][-4:]}"
    else:
        target_hint = None
    return {
        "credentials_configured": is_feishu_configured(),
        "webhook_configured": is_webhook_configured(),
        "app_bot_configured": is_push_configured(),
        "channel": pick_channel(),
        "target_hint": target_hint,
    }


def reset_token_cache() -> None:
    _token_cache.clear()


async def _get_tenant_token(client: httpx.AsyncClient) -> str:
    env = _feishu_env()
    app_id, app_secret = env["FEISHU_APP_ID"], env["FEISHU_APP_SECRET"]
    if not app_id or not app_secret:
        raise RuntimeError("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET")
    now_ms = time.time() * 1000
    cached = _token_cache.get(app_id)
    if cached and cached[1] > now_ms:
        return cached[0]
    resp = await client.post(
        f"{FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("tenant_access_token")
    if not token:
        raise RuntimeError("飞书未返回 tenant_access_token")
    expire = float(data.get("expire") or _TOKEN_TTL)
    _token_cache[app_id] = (token, now_ms + max(60.0, expire - _REFRESH_BUFFER) * 1000)
    return str(token)


def _webhook_sign(timestamp: int, secret: str) -> str:
    """飞书 webhook 签名：以「timestamp\\n密钥」为 key 对空串 HmacSHA256 再 base64。"""
    key = f"{timestamp}\n{secret}".encode()
    return base64.b64encode(hmac.new(key, b"", hashlib.sha256).digest()).decode()


async def send_webhook(card: dict[str, Any] | None = None, text: str | None = None) -> dict[str, Any]:
    """自定义机器人 webhook 发送（card 优先，否则 text）。★真实发送。"""
    env = _feishu_env()
    url = env["FEISHU_WEBHOOK_URL"]
    if not url:
        raise RuntimeError("缺少 FEISHU_WEBHOOK_URL")
    payload: dict[str, Any] = (
        {"msg_type": "interactive", "card": card}
        if card
        else {"msg_type": "text", "content": {"text": (text or "").strip()}}
    )
    if env["FEISHU_WEBHOOK_SECRET"]:
        ts = int(time.time())
        payload["timestamp"] = str(ts)
        payload["sign"] = _webhook_sign(ts, env["FEISHU_WEBHOOK_SECRET"])
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"飞书 webhook 失败: {data.get('msg')}")
        return data


async def send_app_message(card: dict[str, Any] | None = None, text: str | None = None) -> dict[str, Any]:
    """应用机器人 im/v1/messages 发送。★真实发送。"""
    receiver = _resolve_receiver()
    if receiver is None:
        raise RuntimeError("缺少飞书接收方（FEISHU_PUSH_CHAT_ID/OPEN_ID/USER_ID/EMAIL）")
    recv_type, recv_id = receiver
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _get_tenant_token(client)
        content = json.dumps(card) if card else json.dumps({"text": (text or "").strip()})
        resp = await client.post(
            f"{FEISHU_BASE}/open-apis/im/v1/messages",
            params={"receive_id_type": recv_type},
            headers={"authorization": f"Bearer {token}", "content-type": "application/json; charset=utf-8"},
            json={"receive_id": recv_id, "msg_type": "interactive" if card else "text", "content": content},
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"飞书发送失败: {data.get('msg')}")
        result: dict[str, Any] = data.get("data", data)
        return result


def pick_channel() -> str | None:
    """通道选择：webhook > app-bot > None。"""
    if is_webhook_configured():
        return "webhook"
    if is_push_configured():
        return "app-bot"
    return None


async def send(card: dict[str, Any] | None = None, text: str | None = None) -> dict[str, Any]:
    """按通道优先级发送（webhook > app-bot）。★真实发送，调用方须已获用户确认。"""
    channel = pick_channel()
    if channel == "webhook":
        return await send_webhook(card=card, text=text)
    if channel == "app-bot":
        return await send_app_message(card=card, text=text)
    raise RuntimeError("未配置飞书推送通道")


# ---- 压力告警/摘要卡片（移植 feishu-notify.js，纯函数）----

_UPPER, _LOWER = 70, 30


def _sub_score_lines(theme: dict[str, Any]) -> str:
    subs = theme.get("subScores") or []
    if not subs:
        return "· 暂无分项数据"
    return "\n".join(f"· {s['label']}：{s.get('score', '-')}（{s.get('rawText', '')}）" for s in subs)


def build_daily_card(themes: list[dict[str, Any]]) -> dict[str, Any]:
    """每日压力摘要卡片。"""
    elements: list[dict[str, Any]] = []
    for i, theme in enumerate(themes):
        if i > 0:
            elements.append({"tag": "hr"})
        gauge = (
            "🔴"
            if (theme.get("composite") or 0) >= _UPPER
            else "🟢"
            if (theme.get("composite") or 0) <= _LOWER
            else "🟡"
        )
        elements.append(
            {
                "tag": "div",
                "fields": [
                    {
                        "is_short": True,
                        "text": {"tag": "lark_md", "content": f"**{theme['name']}**\n{theme.get('market', '')}"},
                    },
                    {
                        "is_short": True,
                        "text": {"tag": "lark_md", "content": f"**压力指数**\n{gauge} {theme.get('composite')} / 100"},
                    },
                    {"is_short": False, "text": {"tag": "lark_md", "content": f"**状态**：{theme.get('status', '')}"}},
                ],
            }
        )
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": _sub_score_lines(theme)}})
    return {
        "config": {"wide_screen_mode": True},
        "header": {"template": "blue", "title": {"tag": "plain_text", "content": "📊 每日板块压力摘要"}},
        "elements": elements,
    }


def build_crossing_card(crossings: list[dict[str, Any]]) -> dict[str, Any]:
    """跨阈值告警卡片。"""
    any_up = any(t.get("crossing") == "up-70" for t in crossings)
    elements: list[dict[str, Any]] = []
    for i, theme in enumerate(crossings):
        if i > 0:
            elements.append({"tag": "hr"})
        is_up = theme.get("crossing") == "up-70"
        arrow = "🔺 上穿" if is_up else "🔻 下穿"
        line = _UPPER if is_up else _LOWER
        headline = (
            f"**{theme['name']}**（{theme.get('market', '')}）压力指数 {arrow} {line}\n"
            f"当前 **{theme.get('composite')}**，{theme.get('status', '')}"
        )
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": headline}})
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": _sub_score_lines(theme)}})
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "red" if any_up else "green",
            "title": {"tag": "plain_text", "content": "⚠️ 板块压力上穿告警" if any_up else "🟢 板块压力下穿提示"},
        },
        "elements": elements,
    }


# ---- 社群信号源文档读取（移植 feishuSource.js：wiki/docx → 原文 → 按天切分）----

import re  # noqa: E402

_DAY_HEADING = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:\s*·.*)?$")
_MAX_HEADING_LEN = 40
_ATTACHMENT = re.compile(r"^\s*[\w.-]+\.(png|jpe?g|gif|webp|bmp|pdf)\s*$", re.I)


def parse_feishu_resource(input_url: str) -> dict[str, str]:
    """从 wiki/docx/doc 链接或裸 token 解析资源引用。"""
    value = str(input_url or "").strip()
    if not value:
        raise ValueError("缺少飞书 Wiki 或文档链接")
    if "/" in value:
        parts = [p for p in value.split("?")[0].split("/") if p]
        for i, key in enumerate(parts):
            token = parts[i + 1] if i + 1 < len(parts) else ""
            if key == "wiki" and token:
                return {"kind": "wiki", "token": token}
            if key == "docx" and token:
                return {"kind": "docx", "token": token}
            if key in ("doc", "docs") and token:
                return {"kind": "doc", "token": token}
    return {"kind": "wiki", "token": value}


def _drop_attachments(lines: list[str]) -> list[str]:
    return [ln for ln in lines if not _ATTACHMENT.match(ln)]


def split_content_by_day(content: str) -> list[dict[str, str]]:
    """按 YYYY-MM-DD 天级标题切分正文（移植 splitContentByDay）。"""
    days: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in content.split("\n"):
        text = line.strip()
        m = _DAY_HEADING.match(text) if len(text) <= _MAX_HEADING_LEN else None
        if m:
            date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            if days and days[-1]["date"] == date:
                current = days[-1]
                continue
            current = {"date": date, "lines": []}
            days.append(current)
            continue
        if current is not None:
            current["lines"].append(line)
    return [
        {"date": d["date"], "content": re.sub(r"\s+\n", "\n", "\n".join(_drop_attachments(d["lines"])).strip())}
        for d in days
    ]


def build_signal_days(content: str, title: str, fallback_date: str) -> list[dict[str, str]]:
    """正文 → 逐天 {date,title,content}（无天级标题则整段归 fallback_date）。"""
    normalized = re.sub(r"\r\n", "\n", str(content or "")).strip()
    if not normalized:
        raise ValueError("飞书文档内容为空")
    sections = split_content_by_day(normalized)
    if not sections:
        sections = [{"date": fallback_date, "content": normalized}]
    return [
        {"date": s["date"], "title": f"飞书社群信号：{title} · {s['date']}", "content": s["content"]}
        for s in sections
        if s["content"]
    ]


async def fetch_signal_source(input_url: str) -> dict[str, Any]:
    """读取飞书社群信号文档原文（wiki→docx 解析），返回 {title, days}。★真实网络。"""
    resource = parse_feishu_resource(input_url)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _get_tenant_token(client)
        headers = {"authorization": f"Bearer {token}"}
        obj_type, obj_token, title = resource["kind"], resource["token"], "飞书社群信号"
        if resource["kind"] == "wiki":
            node_resp = await client.get(
                f"{FEISHU_BASE}/open-apis/wiki/v2/spaces/get_node", params={"token": resource["token"]}, headers=headers
            )
            node_resp.raise_for_status()
            node = (node_resp.json().get("data") or {}).get("node") or {}
            obj_type = str(node.get("obj_type") or "docx")
            obj_token = str(node.get("obj_token") or "")
            title = node.get("title") or title
            if not obj_token:
                raise RuntimeError("飞书 Wiki 节点未返回 obj_token")
        if obj_type != "docx":
            raise RuntimeError(f"暂不支持读取飞书对象类型：{obj_type}")
        raw_resp = await client.get(
            f"{FEISHU_BASE}/open-apis/docx/v1/documents/{obj_token}/raw_content", headers=headers
        )
        raw_resp.raise_for_status()
        content = ((raw_resp.json().get("data") or {}).get("content")) or ""
    import datetime as _dt
    from zoneinfo import ZoneInfo

    fallback = _dt.datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    return {"title": title, "days": build_signal_days(content, title, fallback)}


async def fetch_signal_source_metadata(input_url: str) -> dict[str, Any]:
    """只验证资源解析和读取权限；不读取正文、不触发抽取。"""
    resource = parse_feishu_resource(input_url)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _get_tenant_token(client)
        headers = {"authorization": f"Bearer {token}"}
        obj_type = resource["kind"]
        obj_token = resource["token"]
        title = "飞书社群信号"
        if resource["kind"] == "wiki":
            response = await client.get(
                f"{FEISHU_BASE}/open-apis/wiki/v2/spaces/get_node",
                params={"token": resource["token"]},
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("code", 0) != 0:
                raise RuntimeError(f"飞书来源检查失败: {data.get('msg')}")
            node = (data.get("data") or {}).get("node") or {}
            obj_type = str(node.get("obj_type") or "docx")
            obj_token = str(node.get("obj_token") or "")
            title = str(node.get("title") or title)
        if obj_type != "docx" or not obj_token:
            raise RuntimeError(f"暂不支持读取飞书对象类型：{obj_type}")
        response = await client.get(
            f"{FEISHU_BASE}/open-apis/docx/v1/documents/{obj_token}",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"飞书文档权限检查失败: {data.get('msg')}")
        document = (data.get("data") or {}).get("document") or {}
        return {
            "ok": True,
            "kind": "docx",
            "title": str(document.get("title") or title),
            "revision_id": str(document.get("revision_id") or ""),
        }
