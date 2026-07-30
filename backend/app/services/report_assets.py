"""报告↔证券关联服务（移植 server/routes/report-assets.js，方案 §11.3）。

link 存 report_asset_links，唯一键 (report_id, instrument_id, relation, source)。
自动建链（source='auto'）：从报告标题/摘要/标签正文抠 6 位代码，仅匹配已知资产（持仓/自选/手动行情）。
手动建链（source='manual'）：调用方指定 assetCode，解析或创建 instrument。
读侧输出保留旧 camelCase shape（assetCode/assetName/...）供前端。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Instrument, Position, QuoteOverride, Report, ReportAssetLink, WatchlistItem
from app.repositories.scoping import scope_condition

_CODE_RE = re.compile(r"(?:^|[^\d])(\d{6})(?!\d)")


def _link_view(link: ReportAssetLink, inst: Instrument | None) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "reportId": link.report_id,
        "instrumentId": str(link.instrument_id),
        "assetCode": inst.display_code if inst else "",
        "assetName": inst.name if inst else "",
        "assetMarket": inst.market if inst else "",
        "relation": link.relation,
        "source": link.source,
        "createdAt": link.created_at.isoformat() if link.created_at else None,
        "updatedAt": link.updated_at.isoformat() if link.updated_at else None,
    }


def get_report_asset_links(session: Session, report_id: str) -> list[dict[str, Any]]:
    """某报告的关联资产（manual 优先、按创建倒序）。"""
    rows = session.execute(
        select(ReportAssetLink, Instrument)
        .join(Instrument, ReportAssetLink.instrument_id == Instrument.id)
        .where(ReportAssetLink.report_id == report_id)
        .order_by((ReportAssetLink.source == "manual").desc(), ReportAssetLink.created_at.desc())
    ).all()
    return [_link_view(link, inst) for link, inst in rows]


def get_asset_report_links(session: Session, asset_code: str, viewer_id: uuid.UUID) -> list[dict[str, Any]]:
    """某证券被关联的报告（只返查看者可见：shared 或自有；排除归档个人态无关）。"""
    code = str(asset_code or "").strip()
    if not code:
        return []
    # 证券可能有多个 instrument（不同 display_code），按 canonical_symbol 归并匹配
    canonical = code[-6:] if re.search(r"\d{6}", code) else code
    rows = session.execute(
        select(ReportAssetLink, Report, Instrument)
        .join(Report, ReportAssetLink.report_id == Report.id)
        .join(Instrument, ReportAssetLink.instrument_id == Instrument.id)
        .where(
            (Instrument.canonical_symbol == canonical) | (Instrument.display_code == code),
            scope_condition(Report, viewer_id, access="visible"),
        )
        .order_by(Report.created_at.desc())
        .limit(50)
    ).all()
    out: list[dict[str, Any]] = []
    for link, report, inst in rows:
        view = _link_view(link, inst)
        view["report"] = {
            "id": report.id,
            "title": report.title,
            "topic": report.topic,
            "type": report.type,
            "typeLabel": report.type_label,
            "summary": report.summary,
            "origin": report.origin,
            "originLabel": report.origin_label,
            "localDate": report.local_date,
            "createdAt": report.created_at.isoformat() if report.created_at else None,
        }
        out.append(view)
    return out


def _upsert_link(session: Session, report_id: str, inst: Instrument, relation: str, source: str) -> ReportAssetLink:
    """按唯一键 upsert（存在则更新时间戳，不存在则建）。"""
    now = datetime.now(UTC)
    existing = session.execute(
        select(ReportAssetLink).where(
            ReportAssetLink.report_id == report_id,
            ReportAssetLink.instrument_id == inst.id,
            ReportAssetLink.relation == relation,
            ReportAssetLink.source == source,
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.updated_at = now
        session.flush()
        return existing
    link = ReportAssetLink(
        id=uuid.uuid4(),
        report_id=report_id,
        instrument_id=inst.id,
        relation=relation,
        source=source,
        created_at=now,
        updated_at=now,
    )
    session.add(link)
    session.flush()
    return link


def upsert_report_asset_link(session: Session, report_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """手动建链（source=manual）。报告须存在，证券解析或新建。"""
    from app.services.instrument_service import resolve_or_create_instrument

    code = str(body.get("assetCode") or body.get("code") or "").strip()
    if not report_id:
        raise ValueError("reportId required")
    if not code:
        raise ValueError("assetCode required")
    if session.get(Report, report_id) is None:
        raise LookupError("Report not found")
    inst = resolve_or_create_instrument(
        session,
        code,
        str(body.get("assetMarket") or body.get("market") or ""),
        str(body.get("assetName") or body.get("name") or ""),
    )
    link = _upsert_link(
        session, report_id, inst, str(body.get("relation") or "related"), str(body.get("source") or "manual")
    )
    return _link_view(link, inst)


def delete_report_asset_link(session: Session, link_id: uuid.UUID) -> tuple[bool, ReportAssetLink | None]:
    """删单条关联，返回 (是否删除, 被删行快照供日志)。"""
    link = session.get(ReportAssetLink, link_id)
    if link is None:
        return False, None
    session.delete(link)
    session.flush()
    return True, link


def delete_report_asset_links(session: Session, report_id: str) -> None:
    """删报告全部关联（报告删除时级联，也可单独调）。"""
    for link in session.execute(select(ReportAssetLink).where(ReportAssetLink.report_id == report_id)).scalars().all():
        session.delete(link)


def _known_assets(session: Session) -> dict[str, Instrument]:
    """已知资产（持仓/自选/手动行情涉及的 instrument），按 canonical_symbol 索引。"""
    by_symbol: dict[str, Instrument] = {}
    insts: list[Instrument] = list(
        session.execute(select(Instrument).join(Position, Position.instrument_id == Instrument.id)).scalars().all()
    )
    insts += list(
        session.execute(select(Instrument).join(WatchlistItem, WatchlistItem.instrument_id == Instrument.id))
        .scalars()
        .all()
    )
    for inst in insts:
        by_symbol.setdefault(inst.canonical_symbol, inst)
    # 手动行情覆盖只有 code（无 instrument），按 canonical_symbol 兜底匹配已有 instrument
    for row in session.execute(select(QuoteOverride)).scalars().all():
        m = re.search(r"\d{6}", row.code or "")
        if m and m.group(0) not in by_symbol:
            hit = session.execute(
                select(Instrument).where(Instrument.canonical_symbol == m.group(0)).limit(1)
            ).scalar_one_or_none()
            if hit is not None:
                by_symbol[m.group(0)] = hit
    return by_symbol


def sync_auto_report_asset_links(session: Session, report: Report) -> list[ReportAssetLink]:
    """自动建链（source=auto）：清旧 auto 链，从报告文本抠已知资产代码/名称重建。"""
    for link in (
        session.execute(
            select(ReportAssetLink).where(ReportAssetLink.report_id == report.id, ReportAssetLink.source == "auto")
        )
        .scalars()
        .all()
    ):
        session.delete(link)
    session.flush()

    known = _known_assets(session)
    if not known:
        return []
    texts = [report.title, report.topic, report.summary, *(report.tags or []), *(report.highlights or [])]
    texts = [str(t) for t in texts if t]
    haystack = " ".join(texts)
    matched: dict[str, Instrument] = {}
    for text in texts:
        for m in _CODE_RE.finditer(text):
            inst = known.get(m.group(1))
            if inst is not None:
                matched.setdefault(inst.canonical_symbol, inst)
    for symbol, inst in known.items():
        if inst.name and len(inst.name) >= 2 and inst.name in haystack:
            matched.setdefault(symbol, inst)
    return [_upsert_link(session, report.id, inst, "mentioned", "auto") for inst in list(matched.values())[:20]]
