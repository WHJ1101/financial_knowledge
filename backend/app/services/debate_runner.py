"""可靠的多模型辩论执行器：真实证据、检查点、进度、取消与失败收敛。"""

from __future__ import annotations

import base64
import re
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select

from app.agents.decision.graph import run_debate_graph
from app.config import get_settings
from app.db import SessionLocal
from app.llm.client import make_role_chat_router
from app.llm.context import LlmUnavailable
from app.llm.json import to_json_safe
from app.models import Debate, Instrument
from app.services.instrument_evidence import collect_instrument_evidence


class DebateCanceled(Exception):
    pass


def _checkpoint_context() -> Any:
    from contextlib import contextmanager

    from langgraph.checkpoint.postgres import PostgresSaver
    from langgraph.checkpoint.serde.encrypted import EncryptedSerializer

    settings = get_settings()
    conn_string = settings.database_url.replace("+psycopg2", "")

    @contextmanager
    def context() -> Any:
        with PostgresSaver.from_conn_string(conn_string) as saver:
            if settings.langgraph_aes_key:
                try:
                    key = base64.b64decode(settings.langgraph_aes_key, validate=True)
                except ValueError as exc:
                    raise RuntimeError("FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY 不是有效 base64") from exc
                if len(key) not in (16, 24, 32):
                    raise RuntimeError("FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY 解码后须为 16/24/32 字节")
                saver.serde = EncryptedSerializer.from_pycryptodome_aes(key=key)
            elif settings.environment == "production":
                raise RuntimeError("生产环境必须配置 FINANCE_KNOWLEDGE_LANGGRAPH_AES_KEY")
            saver.setup()
            yield saver

    return context()


def _safe_error_message(exc: Exception) -> str:
    text = str(exc).replace("\n", " ").strip()
    text = re.sub(r"(?i)\b(Bearer\s+)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(
        r"(?i)\b((?:api[_-]?key|token|secret|authorization)\s*[:=]\s*)[^\s,;&]+",
        r"\1[REDACTED]",
        text,
    )
    text = re.sub(r"(?i)([?&](?:api[_-]?key|token|secret)=)[^&\s]+", r"\1[REDACTED]", text)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}\b", "[REDACTED]", text)
    return (text or type(exc).__name__)[:500]


def execute_debate(debate_id: str) -> None:
    """执行或恢复辩论；任务重试复用 graph_thread_id，终态保持幂等。"""
    with SessionLocal() as session:
        debate = session.get(Debate, debate_id)
        if debate is None or debate.status in ("done", "canceled"):
            return
        now = datetime.now(UTC)
        if debate.cancel_requested_at is not None:
            debate.status = "canceled"
            debate.stage = "已取消"
            debate.finished_at = now
            debate.updated_at = now
            session.commit()
            return
        has_previous_attempt = debate.attempt > 0
        previous_assignments = dict(debate.model_assignments or {})
        debate.status = "running"
        debate.attempt += 1
        debate.started_at = debate.started_at or now
        debate.finished_at = None
        debate.progress = max(debate.progress, 10)
        debate.stage = "采集证据"
        debate.error_code = None
        debate.error_message = None
        debate.updated_at = now
        session.commit()

        def update_stage(stage: str, progress: int) -> None:
            session.refresh(debate)
            if debate.status == "canceled" or debate.cancel_requested_at is not None:
                raise DebateCanceled()
            debate.stage = stage
            debate.progress = max(debate.progress, progress)
            debate.updated_at = datetime.now(UTC)
            session.commit()

        try:
            inst = session.get(Instrument, debate.instrument_id)
            if inst is None:
                raise LookupError("instrument_missing")
            router = make_role_chat_router(session, str(debate.execution_owner_id), "debate", debate_id)
            current_assignments = router.snapshot()
            # Key 轮换不会改变无密钥快照，可安全续跑失败节点；若角色/模型路由已改变，
            # 用同一 thread 开一个新 turn 全量重跑，避免把旧分析与新模型混为同一场。
            resume_from_checkpoint = (
                has_previous_attempt and bool(previous_assignments) and previous_assignments == current_assignments
            )
            debate.model_assignments = current_assignments
            debate.updated_at = datetime.now(UTC)
            session.commit()
            evidence = collect_instrument_evidence(
                session,
                inst,
                debate.horizon,
                viewer_id=debate.execution_owner_id,
            )
            update_stage("证据采集完成", 20)
            target = {
                "instrument_id": str(inst.id),
                "code": inst.canonical_symbol,
                "name": inst.name,
                "market": inst.market,
            }
            with _checkpoint_context() as checkpointer:
                report = run_debate_graph(
                    router,
                    target,
                    evidence,
                    horizon=debate.horizon,
                    question=debate.question,
                    thread_id=debate.graph_thread_id,
                    model_assignments=debate.model_assignments,
                    checkpointer=checkpointer,
                    on_stage=update_stage,
                    resume=resume_from_checkpoint,
                )
            update_stage("保存结果", 99)

            # 终态提交也属于执行事务：JSONB 转换或数据库写入失败时必须收敛为 failed。
            # 行锁保证取消与完成只有一个终态胜出。
            locked = session.execute(select(Debate).where(Debate.id == debate_id).with_for_update()).scalar_one()
            if locked.cancel_requested_at is not None or locked.status == "canceled":
                locked.status = "canceled"
                locked.stage = "已取消"
                locked.finished_at = datetime.now(UTC)
                locked.updated_at = datetime.now(UTC)
                session.commit()
                return
            safe_report = cast(dict[str, Any], to_json_safe(report))
            locked.report = safe_report
            judge = safe_report.get("judge") or {}
            locked.verdict = judge.get("verdict")
            locked.confidence = judge.get("confidence")
            locked.status = "done"
            locked.progress = 100
            locked.stage = "完成"
            locked.finished_at = datetime.now(UTC)
            locked.updated_at = datetime.now(UTC)
            session.commit()
        except DebateCanceled:
            session.rollback()
            locked = session.execute(select(Debate).where(Debate.id == debate_id).with_for_update()).scalar_one()
            locked.status = "canceled"
            locked.stage = "已取消"
            locked.finished_at = datetime.now(UTC)
            locked.updated_at = datetime.now(UTC)
            session.commit()
            return
        except Exception as exc:
            # 数据库提交自身也可能触发异常；先恢复 Session，再锁定最新业务行，
            # 避免失败收敛二次报 PendingRollbackError，并尊重并发取消。
            session.rollback()
            locked = session.execute(select(Debate).where(Debate.id == debate_id).with_for_update()).scalar_one()
            if locked.cancel_requested_at is not None or locked.status == "canceled":
                locked.status = "canceled"
                locked.stage = "已取消"
                locked.finished_at = datetime.now(UTC)
                locked.updated_at = datetime.now(UTC)
                session.commit()
                return
            locked.status = "failed"
            if isinstance(exc, LlmUnavailable):
                locked.error_code = "llm_unavailable"
            elif isinstance(exc, LookupError) and str(exc) == "instrument_missing":
                locked.error_code = "instrument_missing"
            else:
                locked.error_code = "debate_execution_failed"
            locked.error_message = _safe_error_message(exc)
            locked.stage = "执行失败"
            locked.finished_at = datetime.now(UTC)
            locked.updated_at = datetime.now(UTC)
            session.commit()
            raise
