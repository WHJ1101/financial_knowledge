"""多模型、多 Agent 辩论图测试；Fake Router 不访问真实 LLM。"""

from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.agents.decision.graph import build_graph, run_debate_graph
from app.agents.decision.roles import run_analyst, run_debater, run_judge, run_risk
from app.agents.decision.state import AnalystView


class FakeRouter:
    def __init__(self) -> None:
        self.calls: Counter[str] = Counter()

    def for_role(self, role: str):
        def chat(system: str, user: str) -> str:
            self.calls[role] += 1
            if role in ("technical", "fundamental"):
                return json.dumps(
                    {
                        "stance": "bull",
                        "points": [f"{role} 看多"],
                        "confidence": 65,
                        "data_gaps": [],
                    }
                )
            if role == "macro":
                return json.dumps(
                    {
                        "stance": "neutral",
                        "points": [],
                        "confidence": 30,
                        "data_gaps": ["宏观代理"],
                    }
                )
            if role == "sentiment":
                return json.dumps(
                    {
                        "stance": "bear",
                        "points": ["情绪过热"],
                        "confidence": 55,
                        "data_gaps": [],
                    }
                )
            if role in ("bull", "bear"):
                return json.dumps(
                    {
                        "points": ["多方开篇" if role == "bull" else "空方开篇"],
                        "rebuttal": "回应对方最强论据",
                        "confidence": 60,
                        "data_gaps": [],
                    }
                )
            if role == "judge":
                return json.dumps(
                    {
                        "verdict": "偏多",
                        "confidence": 65,
                        "key_disagreements": ["情绪 vs 技术"],
                        "bull_case": "技术+基本面共振",
                        "bear_case": "情绪过热",
                        "falsifiers": ["跌破 MA20"],
                        "action": {"stance": "持有", "trigger": "回踩确认", "stop_loss": "-8%"},
                        "data_caveats": ["宏观为代理"],
                    }
                )
            if role == "risk":
                return json.dumps({"risks": ["回撤风险"], "overall": "中性偏多"})
            return "{}"

        return chat

    def snapshot(self) -> dict[str, dict[str, Any]]:
        roles = ("technical", "fundamental", "macro", "sentiment", "bull", "bear", "judge", "risk")
        return {role: {"profile_name": role, "model": f"model-{role}"} for role in roles}


def _evidence() -> dict[str, Any]:
    return {
        "technical": {"ma": "多头", "chg5d": 3.2},
        "fundamental": {"pe": 45},
        "macro": {"data_gap": "缺少宏观"},
        "sentiment": {"signals": ["热度高"]},
    }


def test_full_debate_flow_uses_independent_agents():
    router = FakeRouter()
    target = {"instrument_id": "i1", "code": "301308", "name": "江波龙", "market": "创业板"}
    report = run_debate_graph(router, target, _evidence(), horizon="long", question="估值合理吗")
    assert report["target"]["name"] == "江波龙"
    assert report["horizon"] == "long"
    assert report["question"] == "估值合理吗"
    assert set(report["analysts"]) == {"technical", "fundamental", "macro", "sentiment"}
    assert report["judge"]["verdict"] == "偏多"
    assert report["debate"]["bull"]["rebuttal"]
    assert report["debate"]["bear"]["rebuttal"]
    assert report["risk_review"]["risks"] == ["回撤风险"]
    assert "macro" in report["data_gaps"]
    assert router.calls["bull"] == 2
    assert router.calls["bear"] == 2
    assert all(router.calls[role] >= 1 for role in router.snapshot())


def test_report_normalizes_provider_datetime() -> None:
    evidence = _evidence()
    evidence["fundamental"]["retrieved_at"] = datetime(2026, 7, 17, 7, 18, tzinfo=UTC)

    report = run_debate_graph(
        FakeRouter(),
        {"instrument_id": "i1", "code": "159995", "name": "芯片ETF华夏", "market": "ETF"},
        evidence,
    )

    assert report["evidence_snapshot"]["fundamental"]["retrieved_at"] == "2026-07-17T07:18:00Z"


def test_four_analysts_are_independent_langgraph_nodes():
    nodes = set(build_graph(FakeRouter()).get_graph().nodes)
    assert {
        "analyst_technical",
        "analyst_fundamental",
        "analyst_macro",
        "analyst_sentiment",
    }.issubset(nodes)


def test_resume_reuses_successful_checkpoint_writes():
    class FailJudgeOnceRouter(FakeRouter):
        def __init__(self) -> None:
            super().__init__()
            self.failed = False

        def for_role(self, role: str):
            original = super().for_role(role)
            if role != "judge":
                return original

            def judge(system: str, user: str) -> str:
                if not self.failed:
                    self.failed = True
                    self.calls[role] += 1
                    raise TimeoutError("judge timeout")
                return original(system, user)

            return judge

    router = FailJudgeOnceRouter()
    target = {"instrument_id": "i1", "code": "301308", "name": "江波龙", "market": "创业板"}
    saver = InMemorySaver()
    with pytest.raises(TimeoutError, match="judge timeout"):
        run_debate_graph(router, target, _evidence(), thread_id="resume-1", checkpointer=saver)
    analyst_calls = {role: router.calls[role] for role in ("technical", "fundamental", "macro", "sentiment")}

    report = run_debate_graph(
        router,
        target,
        _evidence(),
        thread_id="resume-1",
        checkpointer=saver,
        resume=True,
    )

    assert report["judge"]["verdict"] == "偏多"
    assert {role: router.calls[role] for role in analyst_calls} == analyst_calls


def test_analyst_parse_failure_degrades():
    def bad_chat(system: str, user: str) -> str:
        return "invalid"

    view = run_analyst(bad_chat, "technical", {"technical": {}})
    assert isinstance(view, AnalystView)
    assert view.stance == "neutral"
    assert view.data_gaps == ["technical 分析解析失败"]


def test_analyst_prompt_serializes_provider_datetime() -> None:
    captured: dict[str, Any] = {}

    def chat(_system: str, user: str) -> str:
        captured.update(json.loads(user))
        return json.dumps({"stance": "neutral", "points": [], "confidence": 50, "data_gaps": []})

    retrieved_at = datetime(2026, 7, 17, 7, 6, tzinfo=UTC)
    view = run_analyst(
        chat,
        "fundamental",
        {"fundamental": {"source": "eastmoney", "retrieved_at": retrieved_at}},
    )

    assert view.confidence == 50
    assert captured["evidence"]["retrieved_at"] == "2026-07-17T07:06:00Z"


def test_all_debate_role_prompts_require_chinese_text_values() -> None:
    systems: list[str] = []

    def capture(response: dict[str, Any]):
        def chat(system: str, _user: str) -> str:
            systems.append(system)
            return json.dumps(response)

        return chat

    run_analyst(
        capture({"stance": "neutral", "points": [], "confidence": 50, "data_gaps": []}),
        "technical",
        {"technical": {}},
    )
    run_debater(
        capture({"points": [], "rebuttal": "", "confidence": 50, "data_gaps": []}),
        "bull",
        {},
    )
    run_judge(
        capture(
            {
                "verdict": "中性",
                "confidence": 50,
                "key_disagreements": [],
                "bull_case": "",
                "bear_case": "",
                "falsifiers": [],
                "action": {"stance": "观望", "trigger": "", "stop_loss": ""},
                "data_caveats": [],
            }
        ),
        {},
        {},
        {},
    )
    run_risk(capture({"risks": [], "overall": "中性"}), {})

    assert len(systems) == 4
    assert all("JSON 字段名严格遵循给定 schema" in system for system in systems)
    assert all("必须使用简体中文" in system for system in systems)
    assert all("禁止输出完整英文句子" in system for system in systems)


def test_macro_analyst_retries_empty_view_when_real_evidence_exists() -> None:
    systems: list[str] = []

    def chat(system: str, _user: str) -> str:
        systems.append(system)
        if len(systems) == 1:
            return json.dumps(
                {"stance": "neutral", "points": [], "confidence": 60, "data_gaps": ["轻量代理时置信度降低"]}
            )
        return json.dumps(
            {
                "stance": "neutral",
                "points": ["PMI 50.3，制造业处于扩张区间"],
                "confidence": 65,
                "data_gaps": [],
            }
        )

    view = run_analyst(
        chat,
        "macro",
        {"macro": {"cpi": {"value": 1.0}, "pmi": {"value": 50.3}, "gdp": {"value": 5.0}}},
    )

    assert len(systems) == 2
    assert "轻量代理" not in systems[0]
    assert "至少给出 2 条" in systems[0]
    assert view.points == ["PMI 50.3，制造业处于扩张区间"]


def test_one_analyst_provider_failure_degrades_without_stopping_graph():
    class PartiallyFailingRouter(FakeRouter):
        def for_role(self, role: str):
            if role == "technical":
                return lambda *_args: (_ for _ in ()).throw(TimeoutError("provider timeout"))
            return super().for_role(role)

    router = PartiallyFailingRouter()
    report = run_debate_graph(
        router,
        {"instrument_id": "i1", "code": "301308", "name": "江波龙", "market": "创业板"},
        _evidence(),
    )

    assert report["analysts"]["technical"]["stance"] == "neutral"
    assert report["analysts"]["technical"]["confidence"] == 0
    assert report["analysts"]["technical"]["data_gaps"] == ["technical 分析调用失败：TimeoutError"]
    assert report["judge"]["verdict"] == "偏多"
