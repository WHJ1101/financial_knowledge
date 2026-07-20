"""辩论 LLM 角色调用（方案 §7.2/§7.3）。

依赖注入 chat client + evidence provider，便于 fake 自验（不打真实 LLM）。
每个角色由运行时路由到独立模型 Profile；未单独配置的角色使用用户默认 Profile。
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import ValidationError

from app.agents.decision.state import AnalystView, DebateView, JudgeResult, RiskReview
from app.llm.json import dumps_json


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
    "fundamental": (
        "你是基本面分析师。先识别 evidence.kind：fund_profile 使用基金规模、资产配置、区间收益、"
        "基金经理和综合评分；其余使用 PE、PB、ROE、营收与利润增速、市值。"
        "基金和 ETF 不要求公司估值字段。只用给定证据，缺失项写入 dataGaps。"
    ),
    "macro": (
        "你是宏观分析师。证据来自真实宏观数据源，基于 CPI、PPI、PMI、GDP、M2 的数值与观测期"
        "分析增长、通胀和流动性环境，并联系目标标的与投资周期。存在有效指标时 points 至少给出 2 条；"
        "只把证据中确实缺失的指标写入 dataGaps。"
    ),
    "sentiment": "你是情绪面分析师。基于社群信号给出立场，缺失项写入 dataGaps。",
}

_ANALYST_SCHEMA = '返回 JSON: {"stance":"bull|bear|neutral","points":[],"confidence":0-100,"data_gaps":[]}'
_CHINESE_OUTPUT_REQUIREMENT = (
    "语言要求：JSON 字段名严格遵循给定 schema；所有字符串字段中的结论、论据、反驳、风险提示和操作建议"
    "必须使用简体中文。仅保留无法准确翻译的必要专有名词、证券代码，以及 PE、PB、ROE、MA5 等指标缩写；"
    "禁止输出完整英文句子。"
)


def _require_chinese_output(system: str) -> str:
    return f"{system} {_CHINESE_OUTPUT_REQUIREMENT}"


def _has_macro_evidence(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return any(
        isinstance(payload.get(code), dict) and payload[code].get("value") is not None
        for code in ("cpi", "ppi", "pmi", "gdp", "m2")
    )


def run_analyst(
    chat: ChatFn,
    role: str,
    evidence: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> AnalystView:
    """单分析师。解析失败→降级为 dataGap（不整体挂，方案 §7.4）。"""
    system = _require_chinese_output(f"{ANALYST_PROMPTS[role]} {_ANALYST_SCHEMA}")
    role_evidence = evidence.get(role, {})
    user = dumps_json({**(context or {}), "evidence": role_evidence})
    try:
        result = AnalystView.model_validate(_parse_json(chat(system, user)))
        if role == "macro" and _has_macro_evidence(role_evidence) and not result.points:
            retry_system = (
                f"{system} 上一轮遗漏了已有宏观数据。重新分析，必须引用具体指标和观测期，points 至少给出 2 条。"
            )
            retried = AnalystView.model_validate(_parse_json(chat(retry_system, user)))
            if retried.points:
                return retried
            return retried.model_copy(
                update={"data_gaps": [*retried.data_gaps, "宏观分析未提取有效观点"]}
            )
        return result
    except (json.JSONDecodeError, ValidationError):
        return AnalystView(stance="neutral", points=[], confidence=0, data_gaps=[f"{role} 分析解析失败"])
    except Exception as exc:  # 单个模型/网络失败按角色降级，其他 Agent 继续
        return AnalystView(
            stance="neutral",
            points=[],
            confidence=0,
            data_gaps=[f"{role} 分析调用失败：{type(exc).__name__}"],
        )


def run_debater(
    chat: ChatFn,
    side: str,
    analyst_views: dict[str, Any],
    opponent: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> DebateView:
    """多方/空方独立 Agent。第二轮传入对方开篇，生成真实反驳。"""
    side_label = "多方" if side == "bull" else "空方"
    stance = "偏多" if side == "bull" else "偏空"
    system = (
        f"你是{side_label}辩手，坚持{stance}立场。只能引用给定分析师观点，指出证据链和数据缺口。"
        '返回 JSON: {"points":[],"rebuttal":"","confidence":0-100,"data_gaps":[]}'
    )
    payload: dict[str, Any] = {**(context or {}), "analysts": analyst_views}
    if opponent:
        payload["opponent_opening"] = opponent
        system += "这是反驳轮：逐点回应对方最强论据，并说明什么条件会使本方失效。"
    system = _require_chinese_output(system)
    try:
        return DebateView.model_validate(_parse_json(chat(system, dumps_json(payload))))
    except (json.JSONDecodeError, ValidationError):
        return DebateView(points=[], rebuttal="辩手输出解析失败", confidence=0, data_gaps=[f"{side} 辩手解析失败"])
    except Exception as exc:  # 多空一侧失败时保留另一侧与后续裁判流程
        return DebateView(
            points=[],
            rebuttal="辩手调用失败",
            confidence=0,
            data_gaps=[f"{side} 辩手调用失败：{type(exc).__name__}"],
        )


def run_judge(
    chat: ChatFn,
    analyst_views: dict[str, Any],
    bull: dict[str, Any],
    bear: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> JudgeResult:
    system = _require_chinese_output(
        "你是裁判。综合多空双方，输出明确 verdict、分歧点、证伪条件、操作建议。"
        "对 dataGaps 非空的面降权。返回 JSON: "
        '{"verdict":"偏多|偏空|中性","confidence":0-100,"key_disagreements":[],'
        '"bull_case":"","bear_case":"","falsifiers":[],'
        '"action":{"stance":"","trigger":"","stop_loss":""},"data_caveats":[]}'
    )
    user = dumps_json({**(context or {}), "analysts": analyst_views, "bull": bull, "bear": bear})
    return JudgeResult.model_validate(_parse_json(chat(system, user)))


def run_risk(
    chat: ChatFn,
    judge: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> RiskReview:
    system = _require_chinese_output('你是风险审查员。列出主要风险。返回 JSON: {"risks":[],"overall":""}')
    try:
        return RiskReview.model_validate(_parse_json(chat(system, dumps_json({**(context or {}), "judge": judge}))))
    except (json.JSONDecodeError, ValidationError):
        return RiskReview(risks=["风险审查解析失败"], overall="")
    except Exception as exc:
        return RiskReview(risks=[f"风险审查调用失败：{type(exc).__name__}"], overall="")
