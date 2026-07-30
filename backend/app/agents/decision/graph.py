"""LangGraph 辩论图（方案 §7.2）。

resolve_target → [并行]四面证据 → validate → [并行]四分析师 → 多空 → 裁判 → 风控 → 落报告。
chat client 依赖注入，fake LLM 可自验全流程（不打真实接口）。
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, Protocol

from langgraph.graph import END, START, StateGraph

from app.agents.decision.role_registry import role_spec, roles_in_parallel_group
from app.agents.decision.roles import ChatFn, run_analyst, run_debater, run_judge, run_risk
from app.agents.decision.state import DISCLAIMER, DecisionState
from app.llm.context import AgentRole
from app.llm.json import to_json_safe

# Graph topology stays explicit for auditability. Adding a role requires one
# registry entry and the corresponding node/edge here.
_ANALYST_NODES: dict[AgentRole, str] = {
    "technical": "analyst_technical",
    "fundamental": "analyst_fundamental",
    "macro": "analyst_macro",
    "sentiment": "analyst_sentiment",
}
_DEBATER_ROLES: tuple[AgentRole, ...] = ("bull", "bear")

assert tuple(_ANALYST_NODES) == roles_in_parallel_group("analysis")
assert roles_in_parallel_group("opening") == _DEBATER_ROLES


class ChatRouter(Protocol):
    def for_role(self, role: AgentRole) -> ChatFn: ...

    def snapshot(self) -> dict[str, dict[str, Any]]: ...


def build_graph(
    router: ChatRouter,
    *,
    checkpointer: Any | None = None,
    on_stage: Any | None = None,
) -> Any:
    """构造可检查点恢复的多模型、多 Agent 辩论图。"""

    def stage(name: str, progress: int) -> None:
        if on_stage is not None:
            on_stage(name, progress)

    def debate_context(state: DecisionState) -> dict[str, Any]:
        return {
            "target": state.get("target") or {},
            "horizon": state.get("horizon") or "swing",
            "question": state.get("question"),
        }

    def validate_evidence(state: DecisionState) -> dict[str, Any]:
        stage("证据校验", 25)
        evidence = state.get("evidence", {})
        gaps = [
            spec.evidence_key
            for role in _ANALYST_NODES
            if not evidence.get((spec := role_spec(role)).evidence_key)
            or bool((evidence.get(spec.evidence_key) or {}).get("data_gap"))
        ]
        stage("四面分析", 35)
        return {"evidence_gaps": gaps}

    def analyst_node(role: AgentRole) -> Any:
        def run(state: DecisionState) -> dict[str, Any]:
            view = run_analyst(
                router.for_role(role_spec(role).route),
                role,
                state.get("evidence", {}),
                debate_context(state),
            )
            return {"analyst_views": {role: view.model_dump()}}

        return run

    def opening_node(state: DecisionState) -> dict[str, Any]:
        stage("多空开篇", 60)
        views = state.get("analyst_views", {})
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="debate-opening") as executor:
            context = debate_context(state)
            bull = executor.submit(
                run_debater,
                router.for_role(role_spec("bull").route),
                "bull",
                views,
                None,
                context,
            )
            bear = executor.submit(
                run_debater,
                router.for_role(role_spec("bear").route),
                "bear",
                views,
                None,
                context,
            )
            return {"bull_case": bull.result().model_dump(), "bear_case": bear.result().model_dump()}

    def rebuttal_node(state: DecisionState) -> dict[str, Any]:
        stage("交叉反驳", 72)
        views = state.get("analyst_views", {})
        bull_opening = state.get("bull_case") or {}
        bear_opening = state.get("bear_case") or {}
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="debate-rebuttal") as executor:
            context = debate_context(state)
            bull = executor.submit(
                run_debater,
                router.for_role(role_spec("bull").route),
                "bull",
                views,
                bear_opening,
                context,
            )
            bear = executor.submit(
                run_debater,
                router.for_role(role_spec("bear").route),
                "bear",
                views,
                bull_opening,
                context,
            )
            bull_result = bull.result().model_dump()
            bear_result = bear.result().model_dump()
        # 保留开篇要点，把第二轮正文落在 rebuttal。
        bull_result["points"] = bull_opening.get("points", [])
        bear_result["points"] = bear_opening.get("points", [])
        return {"bull_case": bull_result, "bear_case": bear_result}

    def judge_node(state: DecisionState) -> dict[str, Any]:
        stage("裁判裁决", 84)
        result = run_judge(
            router.for_role(role_spec("judge").route),
            state.get("analyst_views", {}),
            state.get("bull_case") or {},
            state.get("bear_case") or {},
            debate_context(state),
        )
        return {"judge_result": result.model_dump()}

    def risk_node(state: DecisionState) -> dict[str, Any]:
        stage("风险复核", 94)
        return {
            "risk_review": run_risk(
                router.for_role(role_spec("risk").route),
                state.get("judge_result") or {},
                debate_context(state),
            ).model_dump()
        }

    def persist_node(state: DecisionState) -> dict[str, Any]:
        stage("生成报告", 98)
        report = {
            "target": state.get("target"),
            "horizon": state.get("horizon"),
            "question": state.get("question"),
            "generated_at": datetime.now(UTC).isoformat(),
            "evidence_snapshot": state.get("evidence", {}),
            "analysts": state.get("analyst_views", {}),
            "debate": {"bull": state.get("bull_case"), "bear": state.get("bear_case")},
            "judge": state.get("judge_result"),
            "risk_review": state.get("risk_review"),
            "data_gaps": state.get("evidence_gaps", []),
            "model_assignments": state.get("model_assignments", {}),
            "disclaimer": DISCLAIMER,
        }
        return {"report": to_json_safe(report)}

    g = StateGraph(DecisionState)
    g.add_node("validate_evidence", validate_evidence)
    for role, node_name in _ANALYST_NODES.items():
        g.add_node(node_name, analyst_node(role))
    g.add_node("opening", opening_node)
    g.add_node("rebuttal", rebuttal_node)
    g.add_node("judge", judge_node)
    g.add_node("risk", risk_node)
    g.add_node("persist", persist_node)

    g.add_edge(START, "validate_evidence")
    analyst_nodes = list(_ANALYST_NODES.values())
    for node in analyst_nodes:
        g.add_edge("validate_evidence", node)
    g.add_edge(analyst_nodes, "opening")
    g.add_edge("opening", "rebuttal")
    g.add_edge("rebuttal", "judge")
    g.add_edge("judge", "risk")
    g.add_edge("risk", "persist")
    g.add_edge("persist", END)
    return g.compile(checkpointer=checkpointer)


def run_debate_graph(
    router: ChatRouter,
    target: dict[str, Any],
    evidence: dict[str, Any],
    *,
    horizon: str = "swing",
    question: str | None = None,
    thread_id: str | None = None,
    model_assignments: dict[str, Any] | None = None,
    checkpointer: Any | None = None,
    on_stage: Any | None = None,
    resume: bool = False,
) -> dict[str, Any]:
    """跑一次完整辩论；相同 thread_id 可从 LangGraph checkpoint 恢复。"""
    graph = build_graph(router, checkpointer=checkpointer, on_stage=on_stage)
    run_id = target.get("instrument_id", "")
    config = {"configurable": {"thread_id": thread_id or run_id}} if checkpointer is not None else None
    graph_input: dict[str, Any] | None = {
        "run_id": run_id,
        "horizon": horizon,
        "question": question,
        "target": target,
        "evidence": evidence,
        "model_assignments": model_assignments or router.snapshot(),
    }
    # 异常/进程重启后的续跑必须传 None，LangGraph 才会重放失败节点并复用
    # 已成功节点的 pending writes；若异常发生在入图前，没有 checkpoint，则全新运行。
    if resume and checkpointer is not None and config is not None and checkpointer.get_tuple(config) is not None:
        graph_input = None
    final = graph.invoke(graph_input, config=config)
    report: dict[str, Any] = final["report"]
    return report
