"""LangGraph 辩论图测试（方案 §7，fake LLM 自验，不打真实接口）。"""

from __future__ import annotations

import json

from app.agents.decision.graph import run_debate_graph
from app.agents.decision.roles import run_analyst
from app.agents.decision.state import AnalystView


class FakeChat:
    """按 system prompt 里的角色关键词返回结构化 JSON。"""

    def __call__(self, system: str, user: str) -> str:
        if "技术面" in system:
            return json.dumps({"stance": "bull", "points": ["MA 多头", "放量"], "confidence": 70, "data_gaps": []})
        if "基本面" in system:
            return json.dumps({"stance": "bull", "points": ["PE 合理"], "confidence": 60, "data_gaps": []})
        if "宏观" in system:
            return json.dumps({"stance": "neutral", "points": [], "confidence": 30, "data_gaps": ["宏观代理"]})
        if "情绪面" in system:
            return json.dumps({"stance": "bear", "points": ["情绪过热"], "confidence": 55, "data_gaps": []})
        if "裁判" in system:
            return json.dumps({
                "verdict": "偏多", "confidence": 65, "key_disagreements": ["情绪 vs 技术"],
                "bull_case": "技术+基本面共振", "bear_case": "情绪过热",
                "falsifiers": ["跌破 MA20"], "action": {"stance": "持有", "trigger": "回踩确认", "stop_loss": "-8%"},
                "data_caveats": ["宏观为代理"],
            })
        if "风险" in system:
            return json.dumps({"risks": ["回撤风险"], "overall": "中性偏多"})
        return "{}"


def _evidence() -> dict:
    return {
        "technical": {"ma": "多头", "chg5d": 3.2},
        "fundamental": {"pe": 45},
        "macro": {},  # 缺失 → gap
        "sentiment": {"signals": ["热度高"]},
    }


def test_full_debate_flow():
    target = {"instrument_id": "i1", "code": "301308", "name": "江波龙", "market": "创业板"}
    report = run_debate_graph(FakeChat(), target, _evidence())
    # 报告结构完整（辩论文档 §3.4）
    assert report["target"]["name"] == "江波龙"
    assert set(report["analysts"].keys()) == {"technical", "fundamental", "macro", "sentiment"}
    assert report["judge"]["verdict"] == "偏多"
    assert report["judge"]["falsifiers"] == ["跌破 MA20"]
    assert report["risk_review"]["risks"] == ["回撤风险"]
    assert "非投资建议" in report["disclaimer"]
    # 宏观缺失进 data_gaps
    assert "macro" in report["data_gaps"]


def test_analyst_parse_failure_degrades():
    """LLM 返回非法 JSON → 降级为 dataGap，不抛（方案 §7.4）。"""

    def bad_chat(system: str, user: str) -> str:
        return "这不是 JSON"

    view = run_analyst(bad_chat, "technical", {"technical": {}})
    assert isinstance(view, AnalystView)
    assert view.stance == "neutral"
    assert view.data_gaps == ["technical 分析解析失败"]


def test_bull_bear_split():
    """多空立场正确分组。"""
    target = {"instrument_id": "i1", "code": "x", "name": "x", "market": "A股"}
    report = run_debate_graph(FakeChat(), target, _evidence())
    # 技术+基本面 bull，情绪 bear
    assert len(report["debate"]["bull"]["points"]) >= 2
    assert len(report["debate"]["bear"]["points"]) >= 1
