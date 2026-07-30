"""辩论 LLM 角色调用（方案 §7.2/§7.3）。

依赖注入 chat client + evidence provider，便于 fake 自验（不打真实 LLM）。
每个角色由运行时路由到独立模型 Profile；未单独配置的角色使用用户默认 Profile。
"""

from __future__ import annotations

from typing import Any, Protocol, cast

from pydantic import ValidationError

from app.agents.decision.role_registry import role_spec
from app.agents.decision.state import AnalystView, DebateView, JudgeResult, RiskReview
from app.llm.context import AgentRole
from app.llm.json import DEFAULT_JSON_PARSER, JsonParser, LlmJsonError, dumps_json


class ChatFn(Protocol):
    """同步调用接口（worker 内串行执行；fake 直接返回 JSON 串）。"""

    def __call__(self, system: str, user: str) -> str: ...


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
    role: AgentRole,
    evidence: dict[str, Any],
    context: dict[str, Any] | None = None,
    *,
    parser: JsonParser = DEFAULT_JSON_PARSER,
) -> AnalystView:
    """单分析师。解析失败→降级为 dataGap（不整体挂，方案 §7.4）。"""
    spec = role_spec(role)
    system = _require_chinese_output(f"{spec.prompt} {spec.schema_instruction}")
    role_evidence = evidence.get(spec.evidence_key, {})
    user = dumps_json({**(context or {}), "evidence": role_evidence})
    try:
        result = cast(AnalystView, parser.parse_model(chat(system, user), spec.response_schema))
        if role == "macro" and _has_macro_evidence(role_evidence) and not result.points:
            retry_system = (
                f"{system} 上一轮遗漏了已有宏观数据。重新分析，必须引用具体指标和观测期，points 至少给出 2 条。"
            )
            retried = cast(AnalystView, parser.parse_model(chat(retry_system, user), spec.response_schema))
            if retried.points:
                return retried
            return retried.model_copy(
                update={"data_gaps": [*retried.data_gaps, "宏观分析未提取有效观点"]}
            )
        return result
    except (LlmJsonError, ValidationError):
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
    side: AgentRole,
    analyst_views: dict[str, Any],
    opponent: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    *,
    parser: JsonParser = DEFAULT_JSON_PARSER,
) -> DebateView:
    """多方/空方独立 Agent。第二轮传入对方开篇，生成真实反驳。"""
    spec = role_spec(side)
    system = f"{spec.prompt} {spec.schema_instruction}"
    payload: dict[str, Any] = {**(context or {}), "analysts": analyst_views}
    if opponent:
        payload["opponent_opening"] = opponent
        system += "这是反驳轮：逐点回应对方最强论据，并说明什么条件会使本方失效。"
    system = _require_chinese_output(system)
    try:
        return cast(DebateView, parser.parse_model(chat(system, dumps_json(payload)), spec.response_schema))
    except (LlmJsonError, ValidationError):
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
    *,
    parser: JsonParser = DEFAULT_JSON_PARSER,
) -> JudgeResult:
    spec = role_spec("judge")
    system = _require_chinese_output(f"{spec.prompt} {spec.schema_instruction}")
    user = dumps_json({**(context or {}), "analysts": analyst_views, "bull": bull, "bear": bear})
    return cast(JudgeResult, parser.parse_model(chat(system, user), spec.response_schema))


def run_risk(
    chat: ChatFn,
    judge: dict[str, Any],
    context: dict[str, Any] | None = None,
    *,
    parser: JsonParser = DEFAULT_JSON_PARSER,
) -> RiskReview:
    spec = role_spec("risk")
    system = _require_chinese_output(f"{spec.prompt} {spec.schema_instruction}")
    try:
        return cast(
            RiskReview,
            parser.parse_model(
                chat(system, dumps_json({**(context or {}), "judge": judge})),
                spec.response_schema,
            ),
        )
    except (LlmJsonError, ValidationError):
        return RiskReview(risks=["风险审查解析失败"], overall="")
    except Exception as exc:
        return RiskReview(risks=[f"风险审查调用失败：{type(exc).__name__}"], overall="")
