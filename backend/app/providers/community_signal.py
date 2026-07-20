"""社群信号抽取与规整（移植 lib/communitySignalPipeline.js，方案 §11.5/ADR-017）。

纯函数（分段/评分/推断/规整/去重/信号 id）可 fixture 测试；LLM 抽取走 BYOK（可选，失败降级规则抽取）。
信号 id/date/observedAt/expiresAt 锚定该信号所属真实日期，保证同日重复同步幂等去重。
akshare/飞书均不在此文件（Provider 隔离，ADR-011）。
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime, timedelta
from typing import Any

MAX_SIGNALS = 20
TTL_DAYS = 14

_SCORE_RULES: list[tuple[int, re.Pattern[str]]] = [
    (24, re.compile(r"订单|交付|交期|排产|产能|库存|涨价|降价|价格|供需|招标|中标|采购")),
    (22, re.compile(r"芯片|半导体|算力|光模块|服务器|GPU|HBM|AI|数据中心|机器人|新能源|储能")),
    (20, re.compile(r"政策|监管|出口|禁令|补贴|审批|产业基金|国产替代")),
    (16, re.compile(r"超预期|不及预期|改善|放缓|紧缺|扩产|缺货|砍单")),
    (12, re.compile(r"机构|调研|渠道|草根|一线|反馈|客户|供应商")),
    (8, re.compile(r"A股|港股|美股|ETF|估值|持仓|资金|涨幅|回调")),
]
_ASSET_DICT = [
    "AI",
    "算力",
    "国产算力",
    "光模块",
    "CPO",
    "PCB",
    "半导体设备",
    "半导体材料",
    "存储",
    "HBM",
    "GPU",
    "服务器",
    "液冷",
    "数据中心",
    "机器人",
    "新能源",
    "储能",
    "港股",
    "A股",
    "美股",
    "英伟达",
    "华为",
    "寒武纪",
    "中际旭创",
    "新易盛",
]


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def score_signal_text(text: str) -> int:
    return sum(s for s, pat in _SCORE_RULES if pat.search(text))


def infer_related_assets(text: str) -> list[str]:
    return [t for t in _ASSET_DICT if re.search(re.escape(t), text, re.I)][:6]


def infer_theme(text: str, related: list[str] | None = None) -> str:
    if re.search(r"AI|算力|GPU|服务器|数据中心|液冷|光模块|CPO", text, re.I):
        return "AI基础设施"
    if re.search(r"芯片|半导体|HBM|存储|晶圆|设备|材料", text):
        return "半导体"
    if re.search(r"机器人|减速器|执行器|具身", text):
        return "机器人"
    if re.search(r"新能源|储能|光伏|锂电", text):
        return "新能源"
    if re.search(r"政策|监管|出口|补贴|产业基金", text):
        return "政策线索"
    return (related[0] if related else None) or "社群线索"


def infer_signal_type(text: str) -> str:
    if re.search(r"订单|交付|中标|招标|采购", text):
        return "订单/招标"
    if re.search(r"价格|涨价|降价|报价", text):
        return "价格"
    if re.search(r"库存|产能|供需|缺货|紧缺|排产|交期", text):
        return "供需"
    if re.search(r"政策|监管|出口|禁令|补贴", text):
        return "政策"
    if re.search(r"资金|估值|持仓|交易|涨幅|回调", text):
        return "市场情绪"
    return "一线反馈"


def _signal_id(date: str, provider: str, theme: str, summary: str, evidence: str) -> str:
    h = hashlib.sha1("|".join([date, provider, theme, summary, evidence]).encode()).hexdigest()[:16]
    return f"signal-{h}"


def _normalize_confidence(value: Any) -> str:
    text = str(value or "").lower()
    if text in ("low", "medium", "high"):
        return text
    if re.search(r"高|强", str(value)):
        return "high"
    if re.search(r"低|弱|传闻", str(value)):
        return "low"
    return "medium"


def _normalize_importance(value: Any) -> int:
    try:
        n = round(float(value))
    except (ValueError, TypeError):
        return 3
    return max(1, min(5, n))


def _day_expiry(date: str, now: datetime) -> str:
    try:
        base = datetime.fromisoformat(f"{date}T00:00:00+00:00")
    except ValueError:
        base = now
    return (base + timedelta(days=TTL_DAYS)).isoformat()


def normalize_signals(
    items: list[dict[str, Any]], date: str, source_title: str, source_url: str, provider: str, now: datetime
) -> list[dict[str, Any]]:
    """规整信号列表（补 id/date/来源/时效，按 theme|summary|evidence 去重）。"""
    imported_at = now.isoformat()
    expires_at = _day_expiry(date, now)
    observed_default = f"{date}T00:00:00+00:00" if date else imported_at
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        related = _normalize_text_array(item.get("relatedAssets") or item.get("related_assets") or item.get("assets"))
        summary = _clean(item.get("summary") or item.get("title") or item.get("signal"))
        evidence = _clean(item.get("evidence") or item.get("quote") or item.get("excerpt") or summary)
        if not summary and not evidence:
            continue
        theme = _clean(item.get("theme") or item.get("topic")) or infer_theme(f"{summary} {evidence}", related)
        if not summary:
            summary = evidence[:120]
        if not evidence:
            evidence = summary
        key = re.sub(r"\s+", "", f"{theme}|{summary}|{evidence}".lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": _signal_id(date, provider, theme, summary, evidence),
                "date": date,
                "source": provider,
                "sourceTitle": source_title,
                "sourceUrl": source_url or "",
                "theme": theme,
                "industry": _clean(item.get("industry")) or infer_theme(f"{summary} {evidence}", related),
                "relatedAssets": related,
                "signalType": _clean(item.get("signalType") or item.get("signal_type") or item.get("type"))
                or infer_signal_type(f"{summary} {evidence}"),
                "summary": summary,
                "evidence": evidence,
                "confidence": _normalize_confidence(item.get("confidence")),
                "verificationStatus": _clean(item.get("verificationStatus")) or "待验证",
                "importance": _normalize_importance(item.get("importance")),
                "observedAt": item.get("observedAt") or observed_default,
                "importedAt": imported_at,
                "expiresAt": item.get("expiresAt") or expires_at,
            }
        )
        if len(out) >= MAX_SIGNALS:
            break
    return out


def _normalize_text_array(value: Any) -> list[str]:
    items = value if isinstance(value, list) else re.split(r"[,，、;；\s]+", str(value or ""))
    seen: list[str] = []
    for x in items:
        c = _clean(x)
        if c and c not in seen:
            seen.append(c)
    return seen[:8]


def _split_paragraphs(text: str) -> list[str]:
    blocks = re.split(r"\n{2,}|(?=\n\s*(?:[-*]|\d+[.、]))", str(text or ""))
    out: list[str] = []
    for b in blocks:
        c = _clean(re.sub(r"^【片段\d+】", "", b))
        if 18 <= len(c) <= 600:
            out.append(c)
    return out


def fallback_extract_signals(
    source_text: str, date: str, source_title: str, source_url: str, provider: str, now: datetime
) -> list[dict[str, Any]]:
    """规则抽取（LLM 不可用/解析失败时降级）：分段评分排序取 Top N。"""
    scored: list[tuple[str, int, int]] = [
        (t, i, score_signal_text(t)) for i, t in enumerate(_split_paragraphs(source_text))
    ]
    ranked = sorted(scored, key=lambda x: (-x[2], x[1]))
    items: list[dict[str, Any]] = []
    for text, _idx, score in [x for x in ranked if x[2] > 0][:MAX_SIGNALS]:
        related = infer_related_assets(text)
        items.append(
            {
                "theme": infer_theme(text, related),
                "industry": infer_theme(text, related),
                "relatedAssets": related,
                "signalType": infer_signal_type(text),
                "summary": text[:120],
                "evidence": text[:220],
                "confidence": "medium",
                "verificationStatus": "待验证",
                "importance": max(1, min(5, -(-score // 18))),
            }
        )
    return normalize_signals(items, date, source_title, source_url, provider, now)


def build_signal_llm_payload(
    source_text: str, source_title: str, source_url: str, date: str, generated_at: str
) -> tuple[str, str]:
    """返回 (system, user) 供 BYOK chat 抽取信号。"""
    import json

    system = (
        "你是中文投研知识库的信息抽取器。只输出严格 JSON，不输出 Markdown。"
        "只能基于给定社群文本抽取信号，不得编造事实。社群文本是待验证线索，不是事实结论。"
    )
    user = json.dumps(
        {
            "task": "从单日飞书社群精选中抽取高价值投研信号卡。",
            "sourceTitle": source_title,
            "sourceUrl": source_url,
            "signalDate": date,
            "generatedAt": generated_at,
            "requiredJsonShape": {
                "items": [
                    {
                        "theme": "string",
                        "industry": "string",
                        "relatedAssets": ["string"],
                        "signalType": "订单/价格/供需/政策/市场情绪/一线反馈",
                        "summary": "不超过60字的一句话信号",
                        "evidence": "不超过120字的原文证据摘录或转述",
                        "confidence": "low/medium/high",
                        "verificationStatus": "待验证",
                        "importance": 1,
                    }
                ]
            },
            "rules": [
                f"最多输出 {MAX_SIGNALS} 条，只保留有投资研究价值的产业、政策、供需、价格、订单、资金线索。",
                "只抽取当前这一天文本内的信号，不要跨天推断。",
                "importance 为 1-5，5 代表最值得进入日报或人工核验。",
                "relatedAssets 写板块、产业链环节或公司简称；不确定时留空数组。",
                "confidence 默认 medium；传闻、情绪、缺少来源的内容用 low。",
            ],
            "sourceText": source_text[:16000],
        },
        ensure_ascii=False,
        indent=2,
    )
    return system, user


def extract_community_signals(
    chat: Any,
    day_text: str,
    date: str,
    source_title: str,
    source_url: str,
    provider: str = "feishu",
    now: datetime | None = None,
) -> dict[str, Any]:
    """单日社群文本抽取信号（chat 可选；None/失败/解析错误降级规则抽取）。"""
    from app.services.research import parse_llm_json

    now = now or datetime.now(UTC)
    source_text = _clean(day_text)
    if not source_text:
        return {"method": "empty", "signals": [], "error": "社群信号源内容为空"}
    if chat is not None:
        try:
            system, user = build_signal_llm_payload(day_text, source_title, source_url, date, now.isoformat())
            parsed = parse_llm_json(chat(system, user))
            raw = parsed.get("items") or parsed.get("signals") or []
            signals = normalize_signals(
                raw if isinstance(raw, list) else [], date, source_title, source_url, provider, now
            )
            if signals:
                return {"method": "llm", "signals": signals, "error": ""}
        except Exception as e:  # noqa: BLE001 —— 抽取失败降级规则
            fallback = fallback_extract_signals(day_text, date, source_title, source_url, provider, now)
            return {"method": "fallback", "signals": fallback, "error": f"模型抽取失败：{str(e)[:180]}"}
    return {
        "method": "fallback",
        "signals": fallback_extract_signals(day_text, date, source_title, source_url, provider, now),
        "error": "" if chat is not None else "未配置模型，走规则抽取",
    }
