export function renderReportHtml(report, brief) {
  const generatedAt = localDateTime(new Date(report.createdAt));
  const originLabel = { automation: "自动化产出", manual: "手动产出" }[report.origin] || "未标注";
  const sourceLabel = { manual: "手动调研", chat: "对话入库", codex: "Codex 入库", page: "页面生成", scheduled: "自动日更", seed: "示例种子", daily: "日更任务" }[report.source] || report.source;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(report.title)}</title>
  <style>
    :root { color-scheme:light; --accent:${report.accent}; --ink:#111827; --muted:#64748b; --line:#dbe4f0; --soft:#f7fafc; --paper:#fff; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--soft); color:var(--ink); font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; line-height:1.65; }
    main { max-width:920px; margin:0 auto; padding:48px 28px 72px; }
    article { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:36px; }
    .eyebrow { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:10px 0 14px; font-size:clamp(30px,5vw,48px); line-height:1.1; }
    .meta { color:var(--muted); font-size:14px; display:flex; flex-wrap:wrap; gap:10px 18px; }
    section { border-top:1px solid var(--line); margin-top:30px; padding-top:24px; }
    h2 { font-size:20px; margin:0 0 12px; }
    ul { padding-left:22px; margin:10px 0 0; }
    li+li { margin-top:8px; }
    .summary { margin-top:28px; padding:18px 20px; border-left:4px solid var(--accent); background:#f8fbff; border-radius:6px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
    .quality { border:1px solid var(--line); border-radius:6px; padding:14px; background:#fff; }
    .quality b { display:block; } .quality span { color:var(--muted); font-size:13px; }
    .tag-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    .tag { border:1px solid var(--line); border-radius:999px; padding:4px 10px; color:#334155; font-size:13px; background:#fff; }
    .source-list { display:grid; gap:12px; }
    .source-item { border:1px solid var(--line); border-radius:6px; padding:14px 16px; background:#fff; }
    .source-item strong { display:block; margin-bottom:4px; }
    .source-item p { margin:8px 0 0; color:#334155; }
    .source-meta { color:var(--muted); font-size:13px; }
    @media(max-width:640px) { main{padding:20px 12px 40px;} article{padding:24px 18px;} }
  </style>
</head>
<body>
  <main><article>
    <div class="eyebrow">${esc(report.typeLabel)}</div>
    <h1>${esc(report.title)}</h1>
    <div class="meta">
      <span>生成时间：${esc(generatedAt)}</span>
      <span>产出方式：${esc(originLabel)}</span>
      <span>来源：${esc(sourceLabel)}</span>
    </div>
    <div class="tag-row">${(report.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
    <p class="summary">${esc(brief.summary)}</p>
    ${renderEvidence(brief.evidence)}
    <section><h2>核心观察</h2>${renderList(brief.highlights)}</section>
    <section><h2>跟踪清单</h2>${renderList(brief.watchList)}</section>
    <section><h2>风险与反证</h2>${renderList(brief.risks)}</section>
    <section><h2>下一步</h2>${renderList(brief.nextSteps)}</section>
    <section><h2>系统状态</h2><div class="grid">${brief.dataQuality.map(i=>`<div class="quality"><b>${esc(i.name)}</b><span>${esc(i.status)}</span></div>`).join("")}</div></section>
  </article></main>
</body></html>`;
}

function renderList(items) { return `<ul>${(items||[]).map(i=>`<li>${esc(i)}</li>`).join("")}</ul>`; }

function renderEvidence(evidence = []) {
  if (!evidence.length) return `<section><h2>数据源证据</h2><p>尚未采集到外部或本地数据源。</p></section>`;
  return `<section><h2>数据源证据</h2><div class="source-list">${evidence.map(i => {
    const title = i.url ? `<a href="${esc(i.url)}">${esc(i.title)}</a>` : esc(i.title);
    return `<div class="source-item"><strong>${title}</strong><span class="source-meta">${esc(i.source||"")} · ${esc(i.observedAt||"")}</span><p>${esc(i.excerpt||"")}</p></div>`;
  }).join("")}</div></section>`;
}

function esc(v) { return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }

function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", weekday:"short", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${v.weekday} · ${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
