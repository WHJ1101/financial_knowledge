"""社群信号同步编排（移植 daily-job.js:syncCommunitySignals，方案 §11.5）。

从飞书源逐天读文档 → BYOK 抽取信号 → 按 (source,date,source_title) 覆盖落 community_signals。
飞书未配 → skipped；已入库的天跳过（逐天幂等）。信号本体公共，不带 owner。
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import CommunitySignal
from app.providers.community_signal import extract_community_signals
from app.services.logs import append_log


def _feishu_signal_url() -> str:
    return os.environ.get("FEISHU_SIGNAL_WIKI_URL") or os.environ.get("FEISHU_SIGNAL_URL") or ""


def _has_signals_for_date(session: Session, date: str) -> bool:
    return (
        session.execute(
            select(CommunitySignal.id).where(CommunitySignal.source == "feishu", CommunitySignal.date == date).limit(1)
        ).first()
        is not None
    )


def _replace_snapshot(session: Session, signals: list[dict[str, Any]]) -> int:
    """按 (source,date,sourceTitle) 覆盖落库，返回写入条数。"""
    if not signals:
        return 0
    first = signals[0]
    session.execute(
        delete(CommunitySignal).where(
            CommunitySignal.source == first["source"],
            CommunitySignal.date == first["date"],
            CommunitySignal.source_title == first["sourceTitle"],
        )
    )
    for sig in signals:
        session.add(
            CommunitySignal(
                id=sig["id"],
                date=sig["date"],
                source=sig["source"],
                source_title=sig["sourceTitle"],
                source_url=sig["sourceUrl"],
                theme=sig["theme"],
                industry=sig["industry"],
                related_assets=sig["relatedAssets"],
                signal_type=sig["signalType"],
                summary=sig["summary"],
                evidence=sig["evidence"],
                confidence=sig["confidence"],
                verification_status=sig["verificationStatus"],
                importance=sig["importance"],
                observed_at=sig["observedAt"],
                imported_at=sig["importedAt"],
                expires_at=sig["expiresAt"],
                signal_metadata={},
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
    return len(signals)


async def sync_feishu_signals_async(session: Session, execution_owner_id: str) -> dict[str, Any]:
    """异步同步飞书社群信号，供日更编排与 API 复用。"""
    from app.llm.client import try_make_sync_chat
    from app.providers import feishu

    if not feishu.is_feishu_configured() or not _feishu_signal_url():
        return {"ok": False, "skipped": True, "reason": "未配置飞书社群信号源", "written": 0, "processed_dates": []}

    try:
        source = await feishu.fetch_signal_source(_feishu_signal_url())
    except Exception as e:  # noqa: BLE001 —— 抓取失败降级
        append_log(session, "community_signal_sync", f"Feishu signal sync failed: {e}", {})
        session.commit()
        return {"ok": False, "skipped": False, "reason": str(e)[:200], "written": 0, "processed_dates": []}

    chat, _model = try_make_sync_chat(session, execution_owner_id, "signal_extraction", f"signal:{execution_owner_id}")
    now = datetime.now(UTC)
    written = 0
    processed: list[str] = []
    for day in source["days"]:
        if _has_signals_for_date(session, day["date"]):
            continue
        result = extract_community_signals(
            chat,
            day["content"],
            day["date"],
            source["title"],
            _feishu_signal_url(),
            provider="feishu",
            now=now,
        )
        written += _replace_snapshot(session, result["signals"])
        processed.append(day["date"])

    append_log(
        session,
        "community_signal_sync",
        f"Synced {written} community signals across {len(processed)} day(s)",
        {"processedDates": processed},
    )
    session.commit()
    return {"ok": True, "skipped": False, "reason": "", "written": written, "processed_dates": processed}


def sync_feishu_signals(session: Session, execution_owner_id: str) -> dict[str, Any]:
    """同步入口（同步 FastAPI handler / 脚本）。"""
    import asyncio

    return asyncio.run(sync_feishu_signals_async(session, execution_owner_id))


# 供日报编排取置顶信号（按重要性 + 日期），保留接口对齐旧 getTopCommunitySignals
def top_community_signals(session: Session, limit: int = 8) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            select(CommunitySignal)
            .order_by(CommunitySignal.date.desc(), CommunitySignal.importance.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [
        {
            "theme": r.theme,
            "summary": r.summary,
            "signalType": r.signal_type,
            "relatedAssets": r.related_assets,
            "importance": r.importance,
            "verificationStatus": r.verification_status,
        }
        for r in rows
    ]
