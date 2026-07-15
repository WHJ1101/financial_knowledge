"""LangGraph 辩论图（方案 §7.2）。

resolve_target → [并行]四面证据 → validate → [并行]四分析师 → 多空 → 裁判 → 风控 → 落报告。
chat client 依赖注入，fake LLM 可自验全流程（不打真实接口）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agents.decision.roles import ChatFn, run_analyst, run_judge, run_risk
from app.agents.decision.state import DISCLAIMER, DecisionState

_ANALYSTS = ("technical", "fundamental", "macro", "sentiment")


def build_graph(chat: ChatFn) -> Any:
    """构造辩论图。chat 为注入的 LLM 调用（真实或 fake）。返回编译后的 langgraph。"""

    def validate_evidence(state: DecisionState) -> dict[str, Any]:
        evidence = state.get("evidence", {})
        gaps = [face for face in _ANALYSTS if not evidence.get(face)]
        return {"evidence_gaps": gaps}

    def analysts_node(state: DecisionState) -> dict[str, Any]:
        evidence = state.get("evidence", {})
        views = {role: run_analyst(chat, role, evidence).model_dump() for role in _ANALYSTS}
        return {"analyst_views": views}

    def bull_node(state: DecisionState) -> dict[str, Any]:
        views = state.get("analyst_views", {})
        bull_points = [p for v in views.values() if v["stance"] == "bull" for p in v["points"]]
        return {"bull_case": {"points": bull_points, "rebuttal": ""}}

    def bear_node(state: DecisionState) -> dict[str, Any]:
        views = state.get("analyst_views", {})
        bear_points = [p for v in views.values() if v["stance"] == "bear" for p in v["points"]]
        return {"bear_case": {"points": bear_points, "rebuttal": ""}}

    def judge_node(state: DecisionState) -> dict[str, Any]:
        result = run_judge(
            chat, state.get("analyst_views", {}), state.get("bull_case") or {}, state.get("bear_case") or {}
        )
        return {"judge_result": result.model_dump()}

    def risk_node(state: DecisionState) -> dict[str, Any]:
        return {"risk_review": run_risk(chat, state.get("judge_result") or {}).model_dump()}

    def persist_node(state: DecisionState) -> dict[str, Any]:
        report = {
            "target": state.get("target"),
            "generated_at": datetime.now(UTC).isoformat(),
            "evidence_snapshot": state.get("evidence", {}),
            "analysts": state.get("analyst_views", {}),
            "debate": {"bull": state.get("bull_case"), "bear": state.get("bear_case")},
            "judge": state.get("judge_result"),
            "risk_review": state.get("risk_review"),
            "data_gaps": state.get("evidence_gaps", []),
            "disclaimer": DISCLAIMER,
        }
        return {"report": report}

    g = StateGraph(DecisionState)
    g.add_node("validate_evidence", validate_evidence)
    g.add_node("analysts", analysts_node)
    g.add_node("bull", bull_node)
    g.add_node("bear", bear_node)
    g.add_node("judge", judge_node)
    g.add_node("risk", risk_node)
    g.add_node("persist", persist_node)

    g.add_edge(START, "validate_evidence")
    g.add_edge("validate_evidence", "analysts")
    g.add_edge("analysts", "bull")
    g.add_edge("bull", "bear")
    g.add_edge("bear", "judge")
    g.add_edge("judge", "risk")
    g.add_edge("risk", "persist")
    g.add_edge("persist", END)
    return g.compile()


def run_debate_graph(chat: ChatFn, target: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    """跑一次完整辩论，返回最终 report（方案 §7.2）。"""
    graph = build_graph(chat)
    final = graph.invoke({"run_id": target.get("instrument_id", ""), "target": target, "evidence": evidence})
    report: dict[str, Any] = final["report"]
    return report
