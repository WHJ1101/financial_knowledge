"""辩论工作流状态与数据契约（方案 §7.3，辩论文档 §3.3/§3.4）。

所有 LLM 输出经 Pydantic 校验；解析失败记 dataGap，不写未校验 JSON 进报告。
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field

Stance = Literal["bull", "bear", "neutral"]


class AnalystView(BaseModel):
    """单分析师输出（辩论文档 §3.3）。"""

    stance: Stance
    points: list[str] = Field(default_factory=list)
    confidence: int = Field(ge=0, le=100)
    data_gaps: list[str] = Field(default_factory=list)


class DebateView(BaseModel):
    points: list[str] = Field(default_factory=list)
    rebuttal: str = ""


class ActionView(BaseModel):
    stance: str  # 加仓/减仓/持有/观望
    trigger: str = ""
    stop_loss: str = ""


class JudgeResult(BaseModel):
    """裁判裁决（辩论文档 §3.4）。"""

    verdict: Literal["偏多", "偏空", "中性"]
    confidence: int = Field(ge=0, le=100)
    key_disagreements: list[str] = Field(default_factory=list)
    bull_case: str = ""
    bear_case: str = ""
    falsifiers: list[str] = Field(default_factory=list)
    action: ActionView
    data_caveats: list[str] = Field(default_factory=list)


class RiskReview(BaseModel):
    risks: list[str] = Field(default_factory=list)
    overall: str = ""


class TargetSnapshot(TypedDict):
    instrument_id: str
    code: str
    name: str
    market: str


class DecisionState(TypedDict, total=False):
    """LangGraph 图状态（方案 §7.3）。"""

    run_id: str
    target: TargetSnapshot
    evidence: dict[str, Any]  # 四面证据 {technical, fundamental, macro, sentiment}
    evidence_gaps: list[str]
    analyst_views: dict[str, dict[str, Any]]  # 角色→AnalystView.dict
    bull_case: dict[str, Any] | None
    bear_case: dict[str, Any] | None
    judge_result: dict[str, Any] | None
    risk_review: dict[str, Any] | None
    report: dict[str, Any] | None


DISCLAIMER = "本报告为 AI 多角色辩论推演，非投资建议，不构成买卖依据。"
