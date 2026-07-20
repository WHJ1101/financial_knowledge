"""报告生命周期：创建 / 导入（移植 report-lifecycle.js，方案 §11.2/§11.3）。

统一「研究创建」「外部导入」两条构建路径的写 HTML + 写 DB + 写日志。
LLM 走 BYOK LlmExecutionContext（研究创建）；导入不调 LLM。
report id / file / title 规则对齐旧版；自动化产出按 (local_day,title,topic,type,origin) 去重覆盖。
"""

from __future__ import annotations

import hashlib
import re
import time
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Report, User
from app.services.logs import append_log
from app.services.report_store import build_report_file, write_report_file
from app.services.report_template import REPORT_TYPES, render_report_html

_TZ = ZoneInfo("Asia/Shanghai")


def _local_day(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).astimezone(_TZ).strftime("%Y-%m-%d")


def _slugify(s: str) -> str:
    slug = re.sub(r"[^\w]+", "-", str(s).strip().lower(), flags=re.UNICODE)
    return slug.strip("-")[:80]


def _infer_type(topic: str) -> str:
    if re.search(r"政策|监管|发改委|工信部|财政", topic):
        return "policy"
    if re.search(r"A股|美股|市场|指数|成交|风格|复盘", topic):
        return "market"
    if re.search(r"[（(]?\d{6}[）)]?|个股|公司|财报", topic):
        return "stock"
    if re.search(r"产业|链|材料|算力|半导体|光模块|AI|新能源", topic):
        return "industry"
    return "custom"


def _build_title(topic: str, type_: str, date: str) -> str:
    suffix = {
        "industry": "产业链深度",
        "market": "市场复盘",
        "stock": "个股跟踪",
        "policy": "政策日报",
        "custom": "主题调研",
    }.get(type_, "主题调研")
    return topic if (date in topic or suffix in topic) else f"{topic} - {suffix}"


def _build_id(date: str, topic: str, type_: str) -> str:
    h = hashlib.sha1(f"{topic}-{type_}-{time.time()}".encode()).hexdigest()[:8]
    return f"{date}-{type_}-{_slugify(topic)[:48]}-{h}"


def _normalize_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    return [x.strip() for x in re.split(r"[，,、\n]", str(value or "")) if x.strip()]


def _find_existing_automation(session: Session, local_day: str, title: str, topic: str, type_: str) -> Report | None:
    return session.execute(
        select(Report)
        .where(
            Report.local_date == local_day,
            Report.title == title,
            Report.topic == topic,
            Report.type == type_,
            Report.origin == "automation",
        )
        .order_by(Report.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _save_report(
    session: Session,
    report: Report,
    brief: dict[str, Any],
    html: str,
    log_type: str,
    log_message: str,
    log_meta: dict[str, Any] | None = None,
) -> Report:
    if not report.file:
        raise ValueError("report.file required")
    write_report_file(report.file, html)
    merged = session.merge(report)
    session.flush()
    # 自动建链（source=auto）：从报告文本关联已知资产（持仓/自选/手动行情）
    from app.services.report_assets import sync_auto_report_asset_links

    sync_auto_report_asset_links(session, merged)
    append_log(session, log_type, log_message, {"id": report.id, **(log_meta or {})})
    session.commit()
    return merged


def create_report(
    session: Session, owner: User, topic: str, type_: str, brief: dict[str, Any], source: str = "manual"
) -> Report:
    """研究创建：brief 由调用方跑 run_research_pipeline 得到（含 LLM/证据）。"""
    if not topic:
        raise ValueError("topic is required")
    type_ = type_ if type_ in REPORT_TYPES else _infer_type(topic)
    rtype = REPORT_TYPES[type_]
    origin = "automation" if source in ("scheduled", "daily", "automation") else "manual"
    now = datetime.now(UTC)
    local_day = _local_day(now)
    title = _build_title(topic, type_, local_day)
    existing = _find_existing_automation(session, local_day, title, topic, type_) if origin == "automation" else None
    created_at = existing.created_at if existing else now
    report_id = existing.id if existing else _build_id(local_day, topic, type_)
    file = build_report_file(local_day, report_id)

    report = Report(
        id=report_id,
        owner_id=owner.id,
        visibility="private",
        title=title,
        topic=topic,
        type=type_,
        type_label=rtype["label"],
        summary=brief.get("summary"),
        origin=origin,
        origin_label="自动化产出" if origin == "automation" else "手动产出",
        source=source,
        file=file,
        local_date=local_day,
        tags=brief.get("tags") or [],
        highlights=brief.get("highlights") or [],
        content_status="ok",
        meta={"accent": rtype["accent"], "wiki_path": f"{rtype['path']}/{local_day}-{_slugify(topic)}.html"},
        created_at=created_at,
        updated_at=now,
    )
    html = render_report_html(_report_for_template(report, source), brief)
    return _save_report(session, report, brief, html, "research", f"Created report: {title}")


def import_report(session: Session, owner: User, body: dict[str, Any]) -> Report:
    """外部导入：不调 LLM，正文用提供的 html/content 或模板渲染。"""
    title = str(body.get("title") or body.get("topic") or "").strip()
    topic = str(body.get("topic") or title).strip()
    if not title or not topic:
        raise ValueError("title or topic is required")
    raw_type = str(body.get("type") or "")
    type_ = raw_type if raw_type in REPORT_TYPES else _infer_type(f"{title} {topic}")
    rtype = REPORT_TYPES[type_]
    created_at = _parse_dt(body.get("createdAt")) or datetime.now(UTC)
    raw_local = str(body.get("localDate") or "")
    local_day = raw_local if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_local) else _local_day(created_at)
    report_id = _safe_id(body["id"]) if body.get("id") else _build_id(local_day, topic, type_)
    file = build_report_file(local_day, report_id)
    source = str(body.get("source") or "chat").strip()
    origin = (
        "automation"
        if (source in ("scheduled", "daily", "automation") or body.get("origin") == "automation")
        else "manual"
    )
    tags = _normalize_list(body.get("tags"))
    highlights = _normalize_list(body.get("highlights"))
    summary = str(body.get("summary") or "").strip() or f"{title} 已通过外部入口导入知识库。"

    report = Report(
        id=report_id,
        owner_id=owner.id,
        visibility="private",
        title=title,
        topic=topic,
        type=type_,
        type_label=rtype["label"],
        summary=summary,
        origin=origin,
        origin_label="自动化产出" if origin == "automation" else "手动产出",
        source=source,
        file=file,
        local_date=local_day,
        tags=tags,
        highlights=highlights,
        content_status="ok",
        meta={
            "accent": rtype["accent"],
            "wiki_path": body.get("wikiPath") or f"{rtype['path']}/{local_day}-{_slugify(topic)}.html",
        },
        created_at=created_at,
        updated_at=_parse_dt(body.get("updatedAt")) or created_at,
    )
    brief = {
        "summary": summary,
        "highlights": highlights,
        "watchList": _normalize_list(body.get("watchList")),
        "risks": _normalize_list(body.get("risks")),
        "nextSteps": _normalize_list(body.get("nextSteps")),
        "evidence": body.get("evidence") if isinstance(body.get("evidence"), list) else [],
        "dataQuality": [{"name": "导入来源", "status": "Codex 对话手动入库" if source == "chat" else source}],
    }
    html = _normalize_imported_html(body, _report_for_template(report, source), brief)
    return _save_report(session, report, brief, html, "report_import", f"Imported report: {title}", {"source": source})


def create_daily_briefing_report(
    session: Session, owner: User, brief: dict[str, Any], now: datetime, source: str = "scheduled"
) -> Report:
    """每日市场简报报告（brief 由 run_daily_briefing 得到；owner 为执行超管）。"""
    type_ = "market"
    rtype = REPORT_TYPES[type_]
    local_day = _local_day(now)
    topic = "每日市场简报"
    title = f"{local_day} 每日市场简报"
    existing = _find_existing_automation(session, local_day, title, topic, type_)
    created_at = existing.created_at if existing else now
    if existing:
        report_id = existing.id
    else:
        h = hashlib.sha1(f"{title}-{now.isoformat()}".encode()).hexdigest()[:8]
        report_id = f"{local_day}-daily-briefing-{h}"
    file = build_report_file(local_day, report_id)
    window = brief.get("window")
    window_meta = {
        "start": window.start.isoformat() if window else None,
        "end": window.end.isoformat() if window else None,
        "timezone": getattr(window, "timezone", "Asia/Shanghai"),
    }
    report = Report(
        id=report_id,
        owner_id=owner.id,
        visibility="private",
        title=title,
        topic=topic,
        type=type_,
        type_label="每日简报",
        summary=brief.get("summary"),
        origin="automation",
        origin_label="自动化产出",
        source=source,
        file=file,
        local_date=local_day,
        tags=brief.get("tags") or [],
        highlights=brief.get("highlights") or [],
        content_status="ok",
        meta={
            "accent": rtype["accent"],
            "wiki_path": f"{rtype['path']}/{local_day}-daily-briefing.html",
            "briefing_window": window_meta,
            "source_stats": brief.get("dataQuality") or [],
        },
        created_at=created_at,
        updated_at=now,
    )
    html = render_report_html(_report_for_template(report, source), brief)
    return _save_report(
        session, report, brief, html, "daily_market_briefing", f"Created report: {title}", {"window": window_meta}
    )


def _report_for_template(report: Report, source: str) -> dict[str, Any]:
    return {
        "title": report.title,
        "typeLabel": report.type_label,
        "type": report.type,
        "tags": report.tags,
        "origin": report.origin,
        "source": source,
        "accent": (report.meta or {}).get("accent"),
        "createdAt": report.created_at.isoformat() if report.created_at else None,
    }


def delete_report(session: Session, report_id: str) -> dict[str, Any] | None:
    """删报告：先删 HTML 文件（不可逆，事务外），再原子删关联+报告+写日志（移植 deleteReport）。"""
    from app.services.report_assets import delete_report_asset_links
    from app.services.report_store import delete_report_file

    report = session.get(Report, report_id)
    if report is None:
        return None
    title, file = report.title, report.file
    file_deleted = delete_report_file(file)
    delete_report_asset_links(session, report_id)
    session.delete(report)
    append_log(
        session,
        "report_delete",
        f"Deleted report: {title}",
        {"id": report_id, "title": title, "file": file, "fileDeleted": file_deleted},
    )
    session.commit()
    return {"deleted": True, "fileDeleted": file_deleted}


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _safe_id(value: Any) -> str:
    sid = re.sub(r"[^\w.-]+", "-", str(value or "").strip(), flags=re.UNICODE).strip("-")[:120]
    if not sid:
        raise ValueError("invalid report id")
    return sid


def _escape_html(value: Any) -> str:
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
    )


def _normalize_imported_html(body: dict[str, Any], report: dict[str, Any], brief: dict[str, Any]) -> str:
    html = str(body.get("html") or "").strip()
    if html:
        return html if re.match(r"^<!doctype html|<html[\s>]", html, re.I) else _wrap_fragment(report, html)
    content = str(body.get("content") or body.get("markdown") or "").strip()
    if content:
        return _wrap_fragment(report, f"<pre>{_escape_html(content)}</pre>")
    return render_report_html(report, brief)


def _wrap_fragment(report: dict[str, Any], fragment: str) -> str:
    title = _escape_html(report.get("title"))
    meta = " · ".join(
        _escape_html(x)
        for x in (report.get("originLabel") or report.get("origin"), report.get("typeLabel"), report.get("localDate"))
        if x
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>
  body {{ margin:0; background:#f7fafc; color:#111827; line-height:1.72;
         font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; }}
  main {{ max-width:920px; margin:0 auto; padding:44px 24px 72px; }}
  article {{ background:#fff; border:1px solid #dbe4f0; border-radius:8px; padding:34px; }}
  h1 {{ margin:0 0 12px; font-size:36px; line-height:1.15; }}
  .meta {{ color:#64748b; font-size:14px; margin-bottom:28px; }}
  pre {{ white-space:pre-wrap; word-break:break-word; font-family:inherit; margin:0; }}
</style></head>
<body><main><article><h1>{title}</h1><p class="meta">{meta}</p>{fragment}</article></main></body></html>"""
