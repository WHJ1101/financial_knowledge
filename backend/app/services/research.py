"""研究简报流水线（移植 lib/researchPipeline.js，方案 §11.2/ADR-017）。

证据采集（本地数据源文件 + 在线源 + 历史报告）→ BYOK LLM 生成结构化简报 →
解析失败降级为证据草稿。LLM 统一走 LlmExecutionContext（不回退全局 key）。

纯函数（证据规整/标签/JSON 解析）可 fixture 测试；I/O（读文件/抓取/LLM）在编排函数里。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MAX_EVIDENCE_ITEMS = 12
DEFAULT_EXCERPT_LIMIT = 1200
STRUCTURED_EXCERPT_LIMIT = 5000
LLM_EXCERPT_LIMIT = 1200

_STRUCTURED_RE = re.compile(r"快讯|新闻|资讯|财经|行情|板块|指数|ETF|资金|持仓|成交额|涨跌幅")
_TERM_RE = re.compile(r"[^\W\d_]{2,}|\d{2,}", re.UNICODE)

_TAG_DICTIONARY = [
    "AI",
    "算力",
    "光模块",
    "半导体",
    "锗",
    "InP",
    "低空经济",
    "政策",
    "A股",
    "美股",
    "ETF",
    "财报",
    "产业链",
    "材料",
    "机器人",
    "液冷",
]
_TYPE_TAG_FALLBACK = {
    "industry": "产业链",
    "market": "市场",
    "stock": "个股",
    "policy": "政策",
    "custom": "研究",
}
_FOCUS_WORDS = {
    "industry": ["供需位置", "订单验证", "国产替代"],
    "market": ["指数结构", "成交额", "风格轮动"],
    "stock": ["业绩兑现", "估值锚", "催化事件"],
    "policy": ["政策方向", "落地节奏", "受益环节"],
    "custom": ["核心假设", "证据链", "关键变量"],
}


@dataclass
class Evidence:
    source: str
    title: str
    excerpt: str = ""
    url: str | None = None
    observed_at: str | None = None
    confidence: str = "medium"

    def compact(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "title": self.title,
            "observedAt": self.observed_at,
            "confidence": self.confidence,
            "excerpt": self.excerpt[:LLM_EXCERPT_LIMIT],
        }


@dataclass
class Brief:
    summary: str
    highlights: list[str]
    watch_list: list[str]
    risks: list[str]
    next_steps: list[str]
    tags: list[str] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    data_quality: list[dict[str, str]] = field(default_factory=list)


# ---- 纯函数（证据规整/主题匹配/标签/LLM JSON 解析），fixture 测试 ----


def _unique(values: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for v in values:
        if v not in seen:
            seen[v] = None
    return list(seen.keys())


def merge_tags(*groups: list[str]) -> list[str]:
    flat = [str(t or "").strip() for g in groups for t in g]
    return _unique([t for t in flat if t])


def derive_tags(topic: str, type_: str) -> list[str]:
    low = topic.lower()
    matches = [w for w in _TAG_DICTIONARY if w.lower() in low]
    fallback = _TYPE_TAG_FALLBACK.get(type_)
    return merge_tags([fallback] if fallback else [], matches)[:8]


def topic_terms(topic: str, type_: str) -> list[str]:
    matches = _TERM_RE.findall(str(topic))
    return [t.lower() for t in _unique([type_, *matches])]


def matches_terms(text: str, terms: list[str]) -> bool:
    haystack = str(text or "").lower()
    return any(term in haystack for term in terms)


def _excerpt_limit(title: str, source: str, record: dict[str, Any]) -> int:
    label = " ".join(str(record.get(k) or "") for k in ("type", "category", "dataset", "source")) + f" {title} {source}"
    return STRUCTURED_EXCERPT_LIMIT if _STRUCTURED_RE.search(label) else DEFAULT_EXCERPT_LIMIT


def expand_records(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "records", "data", "list"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return [data]


def normalize_record(record: Any, source: str, fallback_title: str) -> Evidence:
    if not isinstance(record, dict):
        return Evidence(source=source, title=fallback_title, excerpt=str(record)[:DEFAULT_EXCERPT_LIMIT])
    title = str(
        record.get("title") or record.get("name") or record.get("symbol") or record.get("code") or fallback_title
    )
    limit = _excerpt_limit(title, source, record)
    excerpt = (
        record.get("summary")
        or record.get("excerpt")
        or record.get("description")
        or record.get("content")
        or json.dumps(record, ensure_ascii=False, indent=2)
    )
    return Evidence(
        source=source,
        title=title,
        excerpt=str(excerpt)[:limit],
        url=record.get("url") or record.get("link"),
        observed_at=(
            record.get("observedAt") or record.get("publishedAt") or record.get("date") or record.get("updatedAt")
        ),
        confidence=str(record.get("confidence") or record.get("quality") or "medium"),
    )


def filter_matching(records: list[Evidence], topic: str, type_: str) -> list[Evidence]:
    terms = topic_terms(topic, type_)
    matching = [r for r in records if matches_terms(f"{r.title} {r.excerpt} {r.source}", terms)]
    return (matching or records)[:8]


def dedupe_evidence(items: list[Evidence]) -> list[Evidence]:
    seen: set[str] = set()
    out: list[Evidence] = []
    for item in items:
        key = f"{item.source}|{item.title}|{item.observed_at or ''}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _normalize_str_array(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x or "").strip() for x in value if str(x or "").strip()]


def parse_llm_json(content: str) -> dict[str, Any]:
    """从模型输出抠出 JSON（容忍 ```json``` 代码围栏与前后噪声）。"""
    text = str(content or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError) as e:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
            except (ValueError, TypeError):
                raise ValueError("无法解析模型返回的 JSON") from e
        else:
            raise ValueError("无法解析模型返回的 JSON") from e
    if not isinstance(parsed, dict):
        raise ValueError("模型返回的 JSON 不是对象")
    return parsed


def normalize_llm_brief(value: dict[str, Any], evidence: list[Evidence]) -> Brief:
    def text_array(v: Any, label: str) -> list[str]:
        arr = _normalize_str_array(v)[:6]
        return arr or [f"{label} 待补充。当前已采集 {len(evidence)} 条证据。"]

    summary = str(value.get("summary") or "").strip() or "模型已生成研究摘要，但返回内容缺少摘要字段。"
    return Brief(
        summary=summary,
        highlights=text_array(value.get("highlights"), "核心观察"),
        watch_list=text_array(value.get("watchList"), "跟踪清单"),
        risks=text_array(value.get("risks"), "风险与反证"),
        next_steps=text_array(value.get("nextSteps"), "下一步"),
        tags=_normalize_str_array(value.get("tags"))[:8],
    )


def build_evidence_draft(topic: str, type_: str, evidence: list[Evidence], llm_note: str) -> Brief:
    """LLM 不可用/解析失败时的证据草稿（移植 buildEvidenceBasedDraft）。"""
    focus = _FOCUS_WORDS.get(type_, _FOCUS_WORDS["custom"])
    titles = [e.title for e in evidence if e.title][:3]
    source_text = (
        f"已采集 {len(evidence)} 条证据，重点包括：{'、'.join(titles)}。"
        if titles
        else "尚未配置外部数据源，当前仅能形成研究任务草稿。"
    )
    return Brief(
        summary=f"{topic} 已进入数据源采集与模型研究流程。{source_text}{llm_note}",
        highlights=[
            (
                f"证据层已从 {'、'.join(_unique([e.source for e in evidence]))} 汇总信息，需继续校验来源时间与覆盖度。"
                if evidence
                else "数据层尚未接入，当前报告不应作为投资结论使用。"
            ),
            f"{focus[0]} 是本次调研的第一观察维度，应优先补齐可复核数据。",
            f"{focus[1]} 需要和历史区间、同业比较或政策节奏放在一起看。",
        ],
        watch_list=[
            f"补充 {topic} 的高频数据、公告、新闻或研报摘要。",
            "把每条新增证据记录为本地数据源文件，保留来源、时间和可信度。",
            "配置模型后复跑同一主题，对比模型结论和证据是否一致。",
        ],
        risks=[
            "证据覆盖不足时，模型容易把研究框架误写成确定结论。",
            "外部数据源若缺少时间戳，无法判断信息是否过期。",
            "市场主题交易拥挤时，产业逻辑和短线价格可能明显背离。",
        ],
        next_steps=[
            "配置本地数据源目录，放入行情、公告、新闻或自有研究文件。",
            "配置模型密钥、接口地址和模型名称，启用模型分析。",
            "为日更任务拆分固定数据源：市场、政策、产业链、股票池。",
        ],
        tags=derive_tags(topic, type_),
    )


def build_data_quality(evidence: list[Evidence], llm_ok: bool, llm_note: str, model: str) -> list[dict[str, str]]:
    return [
        {"name": "本地报告落盘", "status": "正常"},
        {"name": "数据源采集", "status": f"正常 · {len(evidence)} 条" if evidence else "待配置 · 未发现数据源"},
        {"name": "模型深度分析", "status": f"正常 · {model}" if llm_ok else llm_note},
        {"name": "证据引用", "status": "正常" if evidence else "待配置"},
    ]


# ---- 证据采集（本地数据源文件 + 历史报告；在线源迁移时保留能力，默认不抓）----

_LLM_SYSTEM = (
    "你是金融与产业研究助理。只输出严格 JSON，不输出 Markdown。结论必须基于给定 evidence，"
    "不能编造外部事实。不要生成、改写或序列化证据表格、快讯列表或 HTML；证据区由系统模板统一解析、排序和渲染。"
)


def _collect_local_source_files(data_dir: str, topic: str, type_: str) -> list[Evidence]:
    source_dir = Path(data_dir) / "sources"
    if not source_dir.is_dir():
        return []
    out: list[Evidence] = []
    for path in sorted(source_dir.glob("*.json"))[:24]:
        try:
            data = json.loads(path.read_text("utf-8"))
        except (ValueError, OSError) as e:
            out.append(
                Evidence(
                    source=f"本地数据源：{path.name}",
                    title=f"{path.name} 读取失败",
                    confidence="low",
                    excerpt=str(e)[:280],
                )
            )
            continue
        records = [
            normalize_record(rec, f"本地数据源：{path.name}", f"{path.stem} #{i + 1}")
            for i, rec in enumerate(expand_records(data))
        ]
        out.extend(filter_matching(records, topic, type_))
    return out


def _collect_report_history(topic: str, type_: str, previous_reports: list[dict[str, Any]]) -> list[Evidence]:
    terms = topic_terms(topic, type_)
    out: list[Evidence] = []
    for report in previous_reports:
        text = " ".join(str(report.get(k) or "") for k in ("title", "topic", "summary"))
        text += " " + " ".join(str(t) for t in (report.get("tags") or []))
        if report.get("type") == type_ or matches_terms(text, terms):
            out.append(
                Evidence(
                    source="历史报告",
                    title=str(report.get("title") or ""),
                    url=f"/reports/{report.get('id') or report.get('file')}",
                    observed_at=report.get("createdAt") or report.get("created_at"),
                    confidence="medium",
                    excerpt=str(report.get("summary") or "；".join(report.get("highlights") or [])),
                )
            )
    return out[:5]


def collect_evidence(topic: str, type_: str, data_dir: str, previous_reports: list[dict[str, Any]]) -> list[Evidence]:
    combined = _collect_local_source_files(data_dir, topic, type_) + _collect_report_history(
        topic, type_, previous_reports
    )
    return dedupe_evidence(combined)[:MAX_EVIDENCE_ITEMS]


def build_llm_user_payload(topic: str, type_: str, evidence: list[Evidence], generated_at: str) -> str:
    return json.dumps(
        {
            "task": "基于证据生成一份可落盘网页报告的中文研究简报。",
            "requiredJsonShape": {
                "schemaVersion": 1,
                "summary": "string",
                "highlights": ["string"],
                "watchList": ["string"],
                "risks": ["string"],
                "nextSteps": ["string"],
                "tags": ["string"],
            },
            "outputRules": [
                "只能返回 requiredJsonShape 中列出的字段，不要添加 evidence、sources、tables、markdown、html 字段。",
                "summary 用 1 句中文概括，不超过 80 字。",
                "highlights/watchList/risks/nextSteps 都必须是字符串数组；每个元素只写一句自然语言。",
                "引用行情、板块、快讯时只写结论和含义；原始数据已由 evidence 提供，不能复制粘贴到正文。",
                "今日财经快讯的筛选和展示由系统模板处理，不要在正文中按时间顺序复述快讯流。",
            ],
            "topic": topic,
            "type": type_,
            "generatedAt": generated_at,
            "evidence": [e.compact() for e in evidence],
        },
        ensure_ascii=False,
        indent=2,
    )


def run_research_pipeline(
    chat: Any,
    topic: str,
    type_: str,
    data_dir: str,
    previous_reports: list[dict[str, Any]],
    generated_at: str,
    model: str = "",
) -> Brief:
    """研究流水线主入口（chat 为可选 BYOK 客户端；None 或调用失败时降级证据草稿）。"""
    evidence = collect_evidence(topic, type_, data_dir, previous_reports)
    llm_ok = False
    llm_note = "待配置 · 未配置"
    brief: Brief

    if chat is None:
        brief = build_evidence_draft(topic, type_, evidence, "配置模型密钥或接口地址后可启用模型深度分析。")
    else:
        try:
            content = chat(_LLM_SYSTEM, build_llm_user_payload(topic, type_, evidence, generated_at))
            brief = normalize_llm_brief(parse_llm_json(content), evidence)
            llm_ok = True
        except ValueError as e:  # JSON 解析失败
            llm_note = f"失败 · 模型结果解析失败：{str(e)[:200]}"
            brief = build_evidence_draft(topic, type_, evidence, f"模型调用未完成：{e}")
        except Exception as e:  # noqa: BLE001 —— LLM 抓取/网络异常降级
            llm_note = f"失败 · {str(e)[:200]}"
            brief = build_evidence_draft(topic, type_, evidence, f"模型调用未完成：{e}")

    brief.tags = merge_tags(brief.tags, derive_tags(topic, type_))
    brief.evidence = [e.compact() for e in evidence]
    brief.data_quality = build_data_quality(evidence, llm_ok, llm_note, model or "模型")
    return brief
