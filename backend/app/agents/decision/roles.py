"""辩论 LLM 角色调用（方案 §7.2/§7.3）。

依赖注入 chat client + evidence provider，便于 fake 自验（不打真实 LLM）。
每个角色 prompt 让同一模型扮演不同分析师/辩手/裁判（单模型多角色，辩论文档 §2.1）。
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import ValidationError

from app.agents.decision.state import AnalystView, JudgeResult, RiskReview


class ChatFn(Protocol):
    """同步调用接口（worker 内串行执行；fake 直接返回 JSON 串）。"""

    def __call__(self, system: str, user: str) -> str: ...


def _parse_json(text: str) -> dict[str, Any]:
    """容错解析模型 JSON：去 ``` 围栏 → 截首个 {...}。"""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```")[1] if "```" in t[3:] else t[3:]
        t = t.removeprefix("json").strip()
    try:
        result: dict[str, Any] = json.loads(t)
        return result
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            return dict(json.loads(t[start : end + 1]))
        raise


ANALYST_PROMPTS = {
    "technical": "你是技术面分析师。基于日线指标给出立场，只用给定证据，缺失项写入 dataGaps。",
    "fundamental": "你是基本面分析师。基于估值数据给出立场，只用给定证据，缺失项写入 dataGaps。",
    "macro": "你是宏观分析师。宏观面为轻量代理时置信度降低，缺失项写入 dataGaps。",
    "sentiment": "你是情绪面分析师。基于社群信号给出立场，缺失项写入 dataGaps。",
}

_ANALYST_SCHEMA = '返回 JSON: {"stance":"bull|bear|neutral","points":[],"confidence":0-100,"data_gaps":[]}'


def run_analyst(chat: ChatFn, role: str, evidence: dict[str, Any]) -> AnalystView:
    """单分析师。解析失败→降级为 dataGap（不整体挂，方案 §7.4）。"""
    system = f"{ANALYST_PROMPTS[role]} {_ANALYST_SCHEMA}"
    user = f"证据：{json.dumps(evidence.get(role, {}), ensure_ascii=False)}"
    try:
        return AnalystView.model_validate(_parse_json(chat(system, user)))
    except (json.JSONDecodeError, ValidationError):
        return AnalystView(stance="neutral", points=[], confidence=0, data_gaps=[f"{role} 分析解析失败"])


def run_judge(chat: ChatFn, analyst_views: dict[str, Any], bull: dict[str, Any], bear: dict[str, Any]) -> JudgeResult:
    system = (
        "你是裁判。综合多空双方，输出明确 verdict、分歧点、证伪条件、操作建议。"
        "对 dataGaps 非空的面降权。返回 JSON: "
        '{"verdict":"偏多|偏空|中性","confidence":0-100,"key_disagreements":[],'
        '"bull_case":"","bear_case":"","falsifiers":[],'
        '"action":{"stance":"","trigger":"","stop_loss":""},"data_caveats":[]}'
    )
    user = json.dumps({"analysts": analyst_views, "bull": bull, "bear": bear}, ensure_ascii=False)
    return JudgeResult.model_validate(_parse_json(chat(system, user)))


def run_risk(chat: ChatFn, judge: dict[str, Any]) -> RiskReview:
    system = '你是风险审查员。列出主要风险。返回 JSON: {"risks":[],"overall":""}'
    try:
        return RiskReview.model_validate(_parse_json(chat(system, json.dumps(judge, ensure_ascii=False))))
    except (json.JSONDecodeError, ValidationError):
        return RiskReview(risks=["风险审查解析失败"], overall="")
