"""报告 HTML 模板（移植 server/templates/report.js 核心渲染，方案 §11.2）。

保留旧版页面结构与配色：eyebrow/标题/元信息/标签/摘要/四段列表/证据/系统状态。
证据区按「来源条目」渲染，复杂表格解析降级为文本片段（可读性对齐，不复刻全部表格增强）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

_TZ = ZoneInfo("Asia/Shanghai")

REPORT_TYPES: dict[str, dict[str, str]] = {
    "industry": {"label": "产业链深度", "path": "investing/themes", "accent": "#00a676"},
    "market": {"label": "市场快览", "path": "feeds/market", "accent": "#2563eb"},
    "stock": {"label": "个股跟踪", "path": "investing/stocks", "accent": "#d97706"},
    "policy": {"label": "政策扫描", "path": "feeds/policy", "accent": "#7c3aed"},
    "custom": {"label": "主题调研", "path": "research/themes", "accent": "#0f766e"},
}

_ORIGIN_LABELS = {"automation": "自动化产出", "manual": "手动产出"}
_SOURCE_LABELS = {
    "manual": "手动调研",
    "chat": "对话入库",
    "codex": "Codex 入库",
    "page": "页面生成",
    "scheduled": "自动日更",
    "seed": "示例种子",
    "daily": "日更任务",
}
_CONFIDENCE_LABELS = {"high": "高可信", "medium": "中等", "low": "低可信"}


def esc(value: Any) -> str:
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
    )


def _fmt_datetime(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return str(iso)
    return dt.astimezone(_TZ).strftime("%Y-%m-%d %H:%M:%S")


def _render_list(items: list[Any]) -> str:
    return "<ul>" + "".join(f"<li>{esc(i)}</li>" for i in (items or [])) + "</ul>"


def _render_evidence_item(item: dict[str, Any]) -> str:
    title = esc(item.get("title") or "未命名数据源")
    if item.get("url"):
        title = f'<a href="{esc(item["url"])}" target="_blank" rel="noreferrer">{title}</a>'
    meta = " · ".join(str(x) for x in (item.get("source"), item.get("observedAt")) if x)
    conf = item.get("confidence")
    conf_html = f'<span class="confidence">{esc(_CONFIDENCE_LABELS.get(conf, conf))}</span>' if conf else ""
    excerpt = str(item.get("excerpt") or "").strip()
    body = (
        f'<p class="source-snippet">{esc(excerpt[:2000])}</p>'
        if excerpt
        else '<p class="source-empty">暂无摘要片段。</p>'
    )
    return (
        f'<article class="source-item"><div class="source-top"><div class="source-title">'
        f'<strong>{title}</strong><div class="source-meta">{esc(meta or "来源未标注")}</div></div>'
        f'{conf_html}</div><div class="source-body">{body}</div></article>'
    )


def _render_evidence(evidence: list[dict[str, Any]]) -> str:
    items = [e for e in (evidence or []) if e]
    if not items:
        return (
            '<section><div class="section-head"><h2>数据源证据</h2></div><p>尚未采集到外部或本地数据源。</p></section>'
        )
    body = "".join(_render_evidence_item(e) for e in items)
    return (
        f'<section class="evidence-section"><div class="section-head"><h2>数据源证据</h2>'
        f'<span class="section-note">{len(items)} 条证据</span></div>'
        f'<div class="source-list">{body}</div></section>'
    )


_STYLE = """
    :root { color-scheme:light; --accent:%(accent)s; --ink:#211a10; --ink-soft:#493f30; --muted:#756752; --line:#eadfc9; --line-soft:#f2eadb; --soft:#f7f2e8; --paper:#fffdfa; --accent-wash:#f2dfb5; --ease-out:cubic-bezier(.16,1,.3,1); }
    * { box-sizing:border-box; }
    body { margin:0; background:radial-gradient(circle at 12%% 0, color-mix(in srgb,var(--accent) 11%%,transparent), transparent 25rem),var(--soft); color:var(--ink); font-family:"SF Pro Text",-apple-system,"PingFang SC","Helvetica Neue",system-ui,sans-serif; line-height:1.65; }
    main { max-width:1020px; margin:0 auto; padding:40px 24px 68px; }
    article { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:40px; box-shadow:0 2px 6px rgba(87,61,27,.05),0 20px 54px rgba(87,61,27,.08); animation:document-in .58s var(--ease-out) both; }
    .eyebrow { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.08em; }
    h1, h2 { font-family:"Iowan Old Style","Songti SC","Noto Serif SC",Georgia,serif; }
    h1 { margin:10px 0 14px; font-size:clamp(30px,5vw,48px); line-height:1.1; letter-spacing:-.035em; font-weight:600; }
    .meta { color:var(--muted); font-size:14px; display:flex; flex-wrap:wrap; gap:10px 18px; }
    section { border-top:1px solid var(--line); margin-top:30px; padding-top:24px; }
    h2 { font-size:20px; margin:0 0 12px; letter-spacing:-.018em; }
    .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:14px; }
    .section-head h2 { margin:0; }
    .section-note { color:var(--muted); font-size:13px; }
    ul { padding-left:22px; margin:10px 0 0; }
    li+li { margin-top:8px; }
    .summary { margin-top:28px; padding:18px 20px; border-left:4px solid var(--accent); background:linear-gradient(135deg,var(--accent-wash),color-mix(in srgb,var(--paper) 74%%,var(--accent-wash))); border-radius:9px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
    .quality { border:1px solid var(--line); border-radius:7px; padding:14px; background:var(--paper); box-shadow:0 8px 24px rgba(87,61,27,.035); }
    .quality b { display:block; } .quality span { color:var(--muted); font-size:13px; }
    .tag-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    .tag { border:1px solid color-mix(in srgb,var(--accent) 22%%,var(--line)); border-radius:999px; padding:4px 10px; color:var(--accent); font-size:13px; background:color-mix(in srgb,var(--paper) 78%%,var(--accent-wash)); }
    .source-list { display:grid; gap:12px; }
    .source-item { border:1px solid var(--line); border-radius:8px; background:var(--paper); overflow:hidden; box-shadow:0 8px 26px rgba(87,61,27,.035); transition:border-color .24s var(--ease-out),box-shadow .28s var(--ease-out),transform .28s var(--ease-out); }
    .source-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:14px 16px; border-bottom:1px solid var(--line-soft); background:linear-gradient(180deg,var(--paper),color-mix(in srgb,var(--soft) 78%%,var(--paper))); }
    .source-title strong { display:block; font-size:16px; line-height:1.35; }
    .source-title a { color:inherit; text-decoration:none; }
    .source-meta { color:var(--muted); font-size:12px; margin-top:4px; overflow-wrap:anywhere; }
    .confidence { flex:0 0 auto; border:1px solid color-mix(in srgb,var(--accent) 22%%,var(--line)); border-radius:999px; padding:3px 9px; color:var(--accent); background:color-mix(in srgb,var(--paper) 78%%,var(--accent-wash)); font-size:12px; font-weight:700; }
    .source-body { padding:14px 16px 16px; }
    .source-empty, .source-snippet { margin:0; color:var(--ink-soft); white-space:pre-wrap; word-break:break-word; }
    @media(hover:hover) and (pointer:fine) { .source-item:hover { border-color:color-mix(in srgb,var(--accent) 38%%,var(--line)); box-shadow:0 14px 34px rgba(87,61,27,.08); transform:translateY(-1px); } }
    @keyframes document-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    @media(max-width:640px) { main{padding:16px 10px 36px;} article{padding:24px 18px;border-radius:8px;} .section-head{display:block;} .source-top{display:block;} .confidence{display:inline-block;margin-top:10px;} }
    @media(prefers-reduced-motion:reduce) { article{animation:none;} .source-item{transition:none;} .source-item:hover{transform:none;} }
"""


def render_report_html(report: dict[str, Any], brief: dict[str, Any]) -> str:
    """渲染完整报告 HTML（移植 renderReportHtml）。report 为落库前的报告字典。"""
    accent = report.get("accent") or REPORT_TYPES.get(report.get("type", ""), {}).get("accent", "#9b6817")
    generated_at = _fmt_datetime(report.get("createdAt"))
    origin_label = _ORIGIN_LABELS.get(report.get("origin", ""), "未标注")
    source = report.get("source") or ""
    source_label = _SOURCE_LABELS.get(source, source)
    tags = "".join(f'<span class="tag">{esc(t)}</span>' for t in (report.get("tags") or []))
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(report.get("title"))}</title>
  <style>{_STYLE % {"accent": accent}}</style>
</head>
<body>
  <main><article>
    <div class="eyebrow">{esc(report.get("typeLabel"))}</div>
    <h1>{esc(report.get("title"))}</h1>
    <div class="meta">
      <span>生成时间：{esc(generated_at)}</span>
      <span>产出方式：{esc(origin_label)}</span>
      <span>来源：{esc(source_label)}</span>
    </div>
    <div class="tag-row">{tags}</div>
    <p class="summary">{esc(brief.get("summary"))}</p>
    <section><h2>核心观察</h2>{_render_list(brief.get("highlights") or [])}</section>
    <section><h2>跟踪清单</h2>{_render_list(brief.get("watchList") or [])}</section>
    <section><h2>风险与反证</h2>{_render_list(brief.get("risks") or [])}</section>
    <section><h2>下一步</h2>{_render_list(brief.get("nextSteps") or [])}</section>
    {_render_evidence(brief.get("evidence") or [])}
    <section><h2>系统状态</h2><div class="grid">{
        "".join(
            f'<div class="quality"><b>{esc(i.get("name"))}</b><span>{esc(i.get("status"))}</span></div>'
            for i in (brief.get("dataQuality") or [])
        )
    }</div></section>
  </article></main>
</body></html>"""
