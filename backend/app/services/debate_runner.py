"""辩论执行器（方案 §7.5）。worker 领取后调用，跑 LangGraph 图落报告。

幂等：只更新该 debate，不重复建报告。BYOK 未配 → llm_unavailable。
证据采集在 M8 用真实 Provider 接线；当前用已迁移的 daily_bars/signals 组装可得证据面。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.agents.decision.graph import run_debate_graph
from app.db import SessionLocal
from app.llm.client import LangchainChatClient, resolve_llm_config
from app.llm.context import LlmExecutionContext, LlmUnavailable
from app.models import Debate, Instrument


def _collect_evidence(session: Any, inst: Instrument) -> dict[str, Any]:
    """组装四面证据（方案 §7.2）。宏观面用东财 datacenter 真实数据（带 as_of 时点口径）。"""
    import anyio

    from app.providers.eastmoney_macro import latest_macro_snapshot

    macro = anyio.from_thread.run(latest_macro_snapshot, datetime.now(UTC))
    return {
        "technical": {"instrument": inst.canonical_symbol},  # M9+ 接 daily_bars 指标
        "fundamental": {},  # 接 EastmoneyProvider.snapshot
        "macro": macro,  # ★东财 datacenter 真实宏观（CPI/PPI/PMI/GDP/M2）
        "sentiment": {},  # 接 community_signals 过滤
    }


def _make_chat(session: Any, execution_owner_id: str, run_id: str) -> Any:
    """构造同步 chat 调用（worker 内串行，LangGraph invoke 同步）。BYOK 未配抛 LlmUnavailable。"""
    ctx = LlmExecutionContext(execution_owner_id=execution_owner_id, purpose="debate", run_id=run_id)
    config = resolve_llm_config(session, ctx)
    client = LangchainChatClient(config)

    def chat(system: str, user: str) -> str:
        return client.complete_sync([{"role": "system", "content": system},
                                     {"role": "user", "content": user}])

    return chat


def execute_debate(debate_id: str) -> None:
    """执行辩论。幂等：已终态不重复（方案 §7.5）。"""
    with SessionLocal() as session:
        debate = session.get(Debate, debate_id)
        if debate is None or debate.status in ("done", "canceled"):
            return
        debate.status = "running"
        debate.started_at = datetime.now(UTC)
        debate.progress = 10
        debate.updated_at = datetime.now(UTC)
        session.commit()

        inst = session.get(Instrument, debate.instrument_id)
        if inst is None:
            debate.status = "failed"
            debate.error_code = "instrument_missing"
            session.commit()
            return

        try:
            chat = _make_chat(session, str(debate.execution_owner_id), debate_id)
            evidence = _collect_evidence(session, inst)
            target = {"instrument_id": str(inst.id), "code": inst.canonical_symbol,
                      "name": inst.name, "market": inst.market}
            report = run_debate_graph(chat, target, evidence)
        except LlmUnavailable as e:
            debate.status = "failed"
            debate.error_code = "llm_unavailable"
            debate.error_message = str(e)
            debate.updated_at = datetime.now(UTC)
            session.commit()
            return

        debate.report = report
        judge = report.get("judge") or {}
        debate.verdict = judge.get("verdict")
        debate.confidence = judge.get("confidence")
        debate.status = "done"
        debate.progress = 100
        debate.stage = "完成"
        debate.finished_at = datetime.now(UTC)
        debate.updated_at = datetime.now(UTC)
        session.commit()

