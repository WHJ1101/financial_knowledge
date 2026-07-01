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
    :root { color-scheme:light; --accent:${report.accent}; --ink:#111827; --muted:#64748b; --line:#d8e3f0; --line-soft:#edf2f7; --soft:#f5f8fc; --paper:#fff; --good:#dc2626; --bad:#059669; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--soft); color:var(--ink); font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; line-height:1.65; }
    main { max-width:980px; margin:0 auto; padding:48px 28px 72px; }
    article { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:40px; box-shadow:0 18px 48px rgba(15,23,42,.06); }
    .eyebrow { color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    h1 { margin:10px 0 14px; font-size:clamp(30px,5vw,48px); line-height:1.1; }
    .meta { color:var(--muted); font-size:14px; display:flex; flex-wrap:wrap; gap:10px 18px; }
    section { border-top:1px solid var(--line); margin-top:30px; padding-top:24px; }
    h2 { font-size:20px; margin:0 0 12px; }
    .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:14px; }
    .section-head h2 { margin:0; }
    .section-note { color:var(--muted); font-size:13px; }
    ul { padding-left:22px; margin:10px 0 0; }
    li+li { margin-top:8px; }
    .summary { margin-top:28px; padding:18px 20px; border-left:4px solid var(--accent); background:#f8fbff; border-radius:6px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
    .quality { border:1px solid var(--line); border-radius:6px; padding:14px; background:#fff; }
    .quality b { display:block; } .quality span { color:var(--muted); font-size:13px; }
    .tag-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
    .tag { border:1px solid var(--line); border-radius:999px; padding:4px 10px; color:#334155; font-size:13px; background:#fff; }
    .source-list { display:grid; gap:12px; }
    .source-item { border:1px solid var(--line); border-radius:8px; background:#fff; overflow:hidden; }
    .source-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:14px 16px; border-bottom:1px solid var(--line-soft); background:linear-gradient(180deg,#fff,#fbfdff); }
    .source-title { min-width:0; }
    .source-title strong { display:block; font-size:16px; line-height:1.35; }
    .source-title a { color:inherit; text-decoration:none; }
    .source-title a:hover { color:var(--accent); }
    .source-meta { color:var(--muted); font-size:12px; margin-top:4px; overflow-wrap:anywhere; }
    .confidence { flex:0 0 auto; border:1px solid var(--line); border-radius:999px; padding:3px 9px; color:#334155; background:#f8fafc; font-size:12px; font-weight:700; }
    .source-body { padding:14px 16px 16px; }
    .source-empty, .source-snippet { margin:0; color:#334155; }
    .evidence-datasets { display:grid; gap:12px; }
    .dataset { border:1px solid var(--line-soft); border-radius:8px; overflow:hidden; background:#fff; }
    .dataset-text { padding:12px; margin:0; color:#334155; }
    .dataset-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 12px; background:#f8fafc; border-bottom:1px solid var(--line-soft); }
    .dataset-head span:first-child { font-weight:800; }
    .dataset-count { color:var(--muted); font-size:12px; }
    .data-table-wrap { overflow-x:auto; }
    .data-table { width:100%; border-collapse:collapse; min-width:560px; font-size:13px; }
    .data-table th, .data-table td { padding:8px 10px; border-bottom:1px solid var(--line-soft); text-align:left; vertical-align:top; }
    .data-table th { color:#53657d; font-size:12px; font-weight:800; white-space:nowrap; background:#fbfdff; }
    .data-table tr:last-child td { border-bottom:0; }
    .data-table td { color:#243044; }
    .number { font-variant-numeric:tabular-nums; white-space:nowrap; }
    .positive { color:var(--good); font-weight:800; }
    .negative { color:var(--bad); font-weight:800; }
    .leader-list { display:grid; gap:8px; padding:12px; }
    .leader-row { display:grid; grid-template-columns:36px minmax(0,1fr) auto; gap:12px; align-items:center; padding:10px 12px; border:1px solid var(--line-soft); border-radius:8px; background:#fff; }
    .leader-rank { width:28px; height:28px; display:grid; place-items:center; border-radius:50%; background:#eef4ff; color:#31537d; font-size:12px; font-weight:900; }
    .leader-main { min-width:0; }
    .leader-main strong { display:block; line-height:1.35; }
    .leader-meta { color:var(--muted); font-size:12px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .leader-change { font-variant-numeric:tabular-nums; font-size:18px; font-weight:900; white-space:nowrap; }
    .news-list { display:grid; gap:8px; padding:12px; }
    .news-row { display:grid; grid-template-columns:28px minmax(0,1fr); gap:12px; align-items:start; padding:10px 12px; border:1px solid var(--line-soft); border-radius:8px; background:#fff; }
    .news-rank { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:#eef4ff; color:#31537d; font-size:12px; font-weight:900; }
    .news-meta { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:6px; color:var(--muted); font-size:12px; }
    .news-time { color:#48617f; font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .news-tag { border:1px solid var(--line-soft); border-radius:999px; padding:1px 7px; background:#f8fafc; color:#48617f; }
    .news-title { color:#1f2a3d; line-height:1.5; }
    .news-candidates { margin:4px 12px 12px; border-top:1px dashed var(--line); padding-top:10px; }
    .news-candidates summary { cursor:pointer; color:var(--muted); font-size:13px; font-weight:700; }
    .news-candidate-list { margin:8px 0 0; padding-left:20px; color:#334155; font-size:13px; }
    .news-candidate-list li+li { margin-top:4px; }
    .raw-evidence { margin-top:12px; border-top:1px dashed var(--line); padding-top:10px; }
    .raw-evidence summary { cursor:pointer; color:var(--muted); font-size:13px; font-weight:700; }
    .raw-evidence pre { max-height:260px; overflow:auto; margin:10px 0 0; padding:12px; border-radius:6px; background:#0f172a; color:#dbeafe; font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
    @media(max-width:640px) { main{padding:20px 12px 40px;} article{padding:24px 18px;} .section-head{display:block;} .section-note{display:block;margin-top:4px;} .source-top{display:block;} .confidence{display:inline-block;margin-top:10px;} .data-table{min-width:520px;} .leader-row{grid-template-columns:30px minmax(0,1fr);}.leader-change{grid-column:2;font-size:16px;} .news-row{grid-template-columns:24px minmax(0,1fr);gap:8px;} }
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
    <section><h2>核心观察</h2>${renderList(brief.highlights)}</section>
    <section><h2>跟踪清单</h2>${renderList(brief.watchList)}</section>
    <section><h2>风险与反证</h2>${renderList(brief.risks)}</section>
    <section><h2>下一步</h2>${renderList(brief.nextSteps)}</section>
    ${renderEvidence(brief.evidence)}
    <section><h2>系统状态</h2><div class="grid">${(brief.dataQuality || []).map(i=>`<div class="quality"><b>${esc(i.name)}</b><span>${esc(i.status)}</span></div>`).join("")}</div></section>
  </article></main>
</body></html>`;
}

export function modernizeReportHtml(html) {
  const source = String(html || "");
  if (!source.includes('class="source-item"') || source.includes('class="source-top"')) return html;

  const upgraded = source.replace(
    /<div class="source-item"><strong>([\s\S]*?)<\/strong><span class="source-meta">([\s\S]*?)<\/span><p>([\s\S]*?)<\/p><\/div>/g,
    (_, titleHtml, metaHtml, excerptHtml) => {
      const title = parseTitle(titleHtml);
      const meta = parseMeta(unesc(metaHtml));
      return renderEvidenceItem({
        title: title.text,
        url: title.url,
        source: meta.source,
        observedAt: meta.observedAt,
        excerpt: unesc(excerptHtml)
      });
    }
  );

  return injectModernEvidenceStyles(upgraded);
}

function renderList(items) { return `<ul>${(items||[]).map(i=>`<li>${esc(i)}</li>`).join("")}</ul>`; }

function renderEvidence(evidence = []) {
  const items = (evidence || []).filter(Boolean);
  if (!items.length) return `<section><div class="section-head"><h2>数据源证据</h2></div><p>尚未采集到外部或本地数据源。</p></section>`;
  return `<section class="evidence-section">
    <div class="section-head">
      <h2>数据源证据</h2>
      <span class="section-note">${items.length} 条证据，原始数据已折叠保留</span>
    </div>
    <div class="source-list">${items.map(renderEvidenceItem).join("")}</div>
  </section>`;
}

function renderEvidenceItem(item) {
  const title = item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.title || "未命名数据源")}</a>` : esc(item.title || "未命名数据源");
  const meta = [item.source, item.observedAt].filter(Boolean).join(" · ");
  const confidence = item.confidence ? `<span class="confidence">${esc(confidenceLabel(item.confidence))}</span>` : "";
  return `<article class="source-item">
    <div class="source-top">
      <div class="source-title">
        <strong>${title}</strong>
        <div class="source-meta">${esc(meta || "来源未标注")}</div>
      </div>
      ${confidence}
    </div>
    <div class="source-body">${renderEvidenceContent(item.excerpt, item.title)}</div>
  </article>`;
}

function renderEvidenceContent(excerpt, fallbackLabel = "数据明细") {
  const raw = String(excerpt ?? "").trim();
  if (!raw) return `<p class="source-empty">暂无摘要片段。</p>`;

  const newsItems = parseNewsItems(raw);
  if (newsItems.length && /快讯|新闻|资讯|财经/.test(fallbackLabel)) {
    return `${renderNewsDataset(fallbackLabel, newsItems)}${renderRawEvidence(raw)}`;
  }

  const labeledSections = parseLabeledData(raw);
  if (labeledSections.length) {
    return `<div class="evidence-datasets">${labeledSections.map(renderDatasetSection).join("")}</div>${renderRawEvidence(raw)}`;
  }

  const parsedRows = parseRowsFromText(raw);
  if (parsedRows.rows.length) return `<div class="evidence-datasets">${renderDataset(fallbackLabel || "数据明细", parsedRows.rows, { partial: parsedRows.partial })}</div>${renderRawEvidence(raw)}`;

  return `<p class="source-snippet">${esc(shortText(raw, 360))}</p>${raw.length > 420 ? renderRawEvidence(raw) : ""}`;
}

function parseLabeledData(text) {
  const matches = [...String(text).matchAll(/【([^】\n]{1,40})】/g)];
  if (!matches.length) return [];

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const chunk = text.slice(start, end).trim();
    const parsed = parseRowsFromText(chunk);
    return {
      label: match[1].trim(),
      rows: parsed.rows,
      text: parsed.rows.length ? "" : chunk,
      partial: parsed.partial
    };
  }).filter((section) => section.rows.length || section.text);
}

function renderDatasetSection(section) {
  if (section.rows.length) return renderDataset(section.label, section.rows, { partial: section.partial });
  return `<div class="dataset">
    <div class="dataset-head"><span>${esc(section.label)}</span></div>
    <p class="dataset-text">${esc(shortText(section.text, 260))}</p>
  </div>`;
}

function renderDataset(label, rows, options = {}) {
  const dataRows = rows.slice(0, 6);
  const objectRows = dataRows.filter((row) => row && typeof row === "object" && !Array.isArray(row));

  if (!objectRows.length) {
    return `<div class="dataset">
      <div class="dataset-head"><span>${esc(label)}</span><span class="dataset-count">显示 ${dataRows.length} / ${rows.length} 条</span></div>
      <ul>${dataRows.map((row) => `<li>${esc(shortText(formatPrimitive(row), 90))}</li>`).join("")}</ul>
    </div>`;
  }

  if (/领涨|涨幅|板块/.test(label)) return renderLeaderDataset(label, objectRows, rows.length, options);

  const columns = selectColumns(objectRows);
  return `<div class="dataset">
    <div class="dataset-head"><span>${esc(label)}</span><span class="dataset-count">${datasetCount(objectRows.length, rows.length, options)}</span></div>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${columns.map((key) => `<th>${esc(formatColumnName(key))}</th>`).join("")}</tr></thead>
        <tbody>${objectRows.map((row) => `<tr>${columns.map((key) => `<td class="${cellClass(row[key], key)}">${esc(formatCell(row[key], key))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function renderNewsDataset(label, items) {
  const ranked = rankNewsItems(items);
  const visible = ranked.slice(0, 5);
  const candidates = ranked.slice(0, 20);
  return `<div class="dataset dataset--news">
    <div class="dataset-head"><span>${esc(newsTitle(label, items.length))}</span><span class="dataset-count">按重要性筛选 ${visible.length} / ${items.length} 条</span></div>
    <div class="news-list">
      ${visible.map(renderNewsRow).join("")}
    </div>
    <details class="news-candidates">
      <summary>候选快讯 Top 20</summary>
      <ol class="news-candidate-list">${candidates.map((item) => `<li><b>${esc(formatNewsTime(item.time))}</b> ${esc(item.title)}</li>`).join("")}</ol>
    </details>
  </div>`;
}

function renderNewsRow(item, index) {
  return `<div class="news-row">
    <span class="news-rank">${index + 1}</span>
    <div>
      <div class="news-title">${esc(item.title)}</div>
      <div class="news-meta">
        <time class="news-time">${esc(formatNewsTime(item.time))}</time>
        ${item.tags.slice(0, 3).map((tag) => `<span class="news-tag">${esc(tag)}</span>`).join("")}
      </div>
    </div>
  </div>`;
}

function newsTitle(label, parsedCount) {
  if (/候选池不足/u.test(String(label || ""))) return `候选池不足，仅采集 ${parsedCount} 条`;
  const declared = String(label || "").match(/[（(]\s*(\d+)\s*条\s*[）)]/u)?.[1];
  if (!declared) return "今日最重要的 5 条";
  const declaredCount = Number(declared);
  const suffix = declaredCount !== parsedCount
    ? `候选(${declaredCount}条，已保存${parsedCount}条)`
    : `候选(${declaredCount}条)`;
  return `今日最重要的 5 条 · ${suffix}`;
}

function renderLeaderDataset(label, rows, total, options = {}) {
  const keys = unique(rows.flatMap((row) => Object.keys(row || {})));
  const nameKey = findKey(keys, /简称|名称|name|title|板块|行业|主题/i);
  const codeKey = findKey(keys, /代码|symbol|code|ticker/i);
  const changeKey = findKey(keys, /涨跌幅|涨幅|change|pct|收益率|rate/i);
  const typeKey = findKey(keys, /类型|领域|分类|成分|概念/i);

  return `<div class="dataset dataset--leaders">
    <div class="dataset-head"><span>${esc(label)}</span><span class="dataset-count">${datasetCount(rows.length, total, options)}</span></div>
    <div class="leader-list">
      ${rows.map((row, index) => renderLeaderRow({ row, index, nameKey, codeKey, changeKey, typeKey })).join("")}
    </div>
  </div>`;
}

function renderLeaderRow({ row, index, nameKey, codeKey, changeKey, typeKey }) {
  const name = nameKey ? row[nameKey] : `第 ${index + 1} 项`;
  const code = codeKey ? row[codeKey] : "";
  const type = typeKey ? row[typeKey] : "";
  const change = changeKey ? row[changeKey] : null;
  return `<div class="leader-row">
    <span class="leader-rank">${index + 1}</span>
    <div class="leader-main">
      <strong>${esc(formatCell(name, nameKey || ""))}</strong>
      <div class="leader-meta">${esc([formatCell(code, codeKey || ""), formatCell(type, typeKey || "")].filter(Boolean).join(" · "))}</div>
    </div>
    <span class="leader-change ${cellClass(change, changeKey || "")}">${esc(formatCell(change, changeKey || ""))}</span>
  </div>`;
}

function datasetCount(visible, total, options = {}) {
  if (options.partial) return `已恢复 ${visible} 条完整数据`;
  return `显示 ${visible} / ${total} 条`;
}

function selectColumns(rows) {
  const keys = unique(rows.flatMap((row) => Object.keys(row || {})))
    .filter((key) => rows.some((row) => hasValue(row[key])));
  const signalColumns = selectSignalColumns(keys);
  if (signalColumns.length) return signalColumns;

  const preferred = [
    findKey(keys, /简称|名称|name|title|板块|行业|主题/i),
    findKey(keys, /代码|symbol|code|ticker/i),
    findKey(keys, /涨跌幅|涨幅|change|pct|收益率|rate/i),
    findKey(keys, /成交额|成交量|amount|volume|净流入|资金|市值/i),
    findKey(keys, /类型|领域|分类|概念|成分/i)
  ].filter(Boolean);
  return unique([...preferred, ...keys]).slice(0, 5);
}

function selectSignalColumns(keys) {
  const hasSignalShape = keys.some((key) => /摘要|summary/i.test(key))
    && keys.some((key) => /重要性|优先级|importance|score/i.test(key));
  if (!hasSignalShape) return [];
  return [
    findKey(keys, /主题|theme|topic/i),
    findKey(keys, /类型|signal.?type|type/i),
    findKey(keys, /相关资产|相关标的|资产|标的|related/i),
    findKey(keys, /重要性|优先级|importance|score/i),
    findKey(keys, /状态|status/i),
    findKey(keys, /摘要|summary/i)
  ].filter(Boolean);
}

function findKey(keys, pattern) {
  return keys.find((key) => pattern.test(key));
}

function normalizeRows(value) {
  if (Array.isArray(value)) return value.filter(hasValue);
  if (value && typeof value === "object") {
    if (Array.isArray(value.items)) return value.items.filter(hasValue);
    if (Array.isArray(value.records)) return value.records.filter(hasValue);
    if (Array.isArray(value.data)) return value.data.filter(hasValue);
    return [value];
  }
  return hasValue(value) ? [value] : [];
}

function parseRowsFromText(value) {
  const parsed = parseJson(value);
  if (parsed.ok) return { rows: normalizeRows(parsed.value), partial: false };
  const objectRows = extractCompleteObjects(value);
  if (objectRows.length) return { rows: objectRows, partial: true };
  const delimitedRows = parseDelimitedRows(value);
  return { rows: delimitedRows, partial: false };
}

function parseNewsItems(value) {
  const text = String(value || "").replace(/\r/g, "").trim();
  const pattern = /\[\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?|\d{2}:\d{2}(?::\d{2})?)\s*\]\s*/gu;
  const matches = [...text.matchAll(pattern)];
  return matches
    .map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      const title = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (!title) return null;
      return { time: match[1].trim(), title };
    })
    .filter(Boolean);
}

function rankNewsItems(items) {
  return items
    .map((item, index) => {
      const score = scoreNewsItem(item.title) - index * 0.01;
      return { ...item, index, score, tags: newsTags(item.title) };
    })
    .sort((a, b) => b.score - a.score || newsTimeValue(b.time) - newsTimeValue(a.time) || a.index - b.index);
}

function scoreNewsItem(title) {
  const text = String(title || "");
  let score = 0;
  for (const rule of NEWS_IMPORTANCE_RULES) {
    if (rule.pattern.test(text)) score += rule.score;
  }
  return score;
}

function newsTags(title) {
  const text = String(title || "");
  const tags = NEWS_IMPORTANCE_RULES
    .filter((rule) => rule.score > 0 && rule.pattern.test(text))
    .map((rule) => rule.tag);
  return unique(tags.length ? tags : ["一般快讯"]);
}

const NEWS_IMPORTANCE_RULES = [
  { tag: "宏观流动性", score: 36, pattern: /央行|人民银行|降准|降息|逆回购|MLF|LPR|流动性|货币政策|财政部|国债|特别国债|社融|CPI|PPI|PMI/u },
  { tag: "监管政策", score: 30, pattern: /证监会|交易所|监管|IPO|减持|回购|并购|重组|退市|反垄断|数据安全|网信办|发改委|工信部/u },
  { tag: "地缘政策", score: 26, pattern: /关税|制裁|出口管制|禁令|地缘|中美|外交部|贸易|冲突|停火|能源安全/u },
  { tag: "AI半导体", score: 24, pattern: /AI|人工智能|算力|芯片|半导体|英伟达|NVIDIA|华为|昇腾|Ascend|HBM|存储|数据中心|光模块|机器人/u },
  { tag: "市场交易", score: 20, pattern: /A股|港股|美股|创业板|科创|沪深|纳指|标普|恒生|ETF|北向|南向|主力|融资|成交额|涨停|跌停/u },
  { tag: "公司事件", score: 14, pattern: /财报|业绩|订单|中标|目标价|评级|召回|专利|增持|减持|分红|停牌|复牌/u },
  { tag: "低相关", score: -10, pattern: /日内涨幅|抹去日内|股东大会|人事变动|取得\d*项发明专利证书/u }
];

function formatNewsTime(value) {
  const text = String(value || "").trim();
  const time = text.match(/\d{2}:\d{2}(?::\d{2})?$/u)?.[0];
  return time || text;
}

function newsTimeValue(value) {
  const text = String(value || "").trim().replace(" ", "T");
  const date = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(`${text}+08:00`) : null;
  return date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function extractCompleteObjects(value) {
  const text = String(value || "");
  const rows = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, index + 1);
        try {
          rows.push(JSON.parse(candidate));
        } catch {}
        start = -1;
      }
    }
  }

  return rows;
}

function parseDelimitedRows(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => {
      const pairs = String(line || "")
        .split(/\s+\|\s+/)
        .map((part) => part.match(/^\s*([^:：|]{1,40})\s*[:：]\s*(.+?)\s*$/u))
        .filter(Boolean);
      if (pairs.length < 2) return null;
      return Object.fromEntries(pairs.map((match) => [match[1].trim(), parseCellValue(match[2])]));
    })
    .filter(Boolean);
}

function parseCellValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const numeric = Number(text.replaceAll(",", ""));
  return Number.isFinite(numeric) && !/^0\d/.test(text) ? numeric : text;
}

function parseJson(value) {
  const text = String(value || "").trim().replace(/[；;,，]\s*$/u, "");
  if (!text) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const start = Math.min(...["[", "{"].map((token) => {
      const index = text.indexOf(token);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (Number.isFinite(start) && end > start) {
      try {
        return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
      } catch {}
    }
    return { ok: false };
  }
}

function renderRawEvidence(raw) {
  return `<details class="raw-evidence"><summary>查看原始数据</summary><pre>${esc(raw)}</pre></details>`;
}

function formatColumnName(key) {
  return String(key).replace(/\[\d{8}\]/g, "");
}

function formatCell(value, key) {
  if (!hasValue(value)) return "—";
  if (typeof value === "number") return formatNumber(value, key);
  if (typeof value === "object") return shortText(JSON.stringify(value), 56);

  const text = String(value);
  const numeric = Number(text.replaceAll(",", ""));
  if (text.trim() !== "" && Number.isFinite(numeric) && !/代码|code|symbol|ticker/i.test(key)) {
    return formatNumber(numeric, key);
  }
  return shortText(text, 56);
}

function formatNumber(value, key) {
  if (/涨跌幅|涨幅|change|pct|收益率|rate/i.test(key)) return `${trimNumber(value, 2)}%`;
  if (/成交额|成交量|amount|volume|净流入|资金|市值/i.test(key)) return formatLargeNumber(value);
  return trimNumber(value, Math.abs(value) >= 100 ? 2 : 4);
}

function formatLargeNumber(value) {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trimNumber(value / 1e12, 2)}万亿`;
  if (abs >= 1e8) return `${trimNumber(value / 1e8, 2)}亿`;
  if (abs >= 1e4) return `${trimNumber(value / 1e4, 2)}万`;
  return trimNumber(value, 2);
}

function trimNumber(value, digits) {
  return Number(value).toFixed(digits).replace(/\.?0+$/u, "");
}

function cellClass(value, key) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return "";
  if (/涨跌幅|涨幅|change|pct|收益率|rate/i.test(key)) return `number ${numeric >= 0 ? "positive" : "negative"}`;
  return "number";
}

function confidenceLabel(value) {
  const labels = { high: "高可信", medium: "中可信", low: "低可信" };
  return labels[String(value).toLowerCase()] || value;
}

function formatPrimitive(value) {
  return typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
}

function shortText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function unique(items) {
  return [...new Set(items)];
}

function injectModernEvidenceStyles(html) {
  if (html.includes("modern-evidence-styles")) return html;
  const styles = `<style id="modern-evidence-styles">
    .source-item { padding:0 !important; border-radius:8px !important; overflow:hidden; }
    .source-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:14px 16px; border-bottom:1px solid var(--line-soft,#edf2f7); background:linear-gradient(180deg,#fff,#fbfdff); }
    .source-title { min-width:0; }
    .source-title strong { display:block; font-size:16px; line-height:1.35; margin:0; }
    .source-title a { color:inherit; text-decoration:none; }
    .source-title a:hover { color:var(--accent); }
    .source-meta { color:var(--muted); font-size:12px; margin-top:4px; overflow-wrap:anywhere; }
    .source-body { padding:14px 16px 16px; }
    .source-empty, .source-snippet { margin:0; color:#334155; }
    .evidence-datasets { display:grid; gap:12px; }
    .dataset { border:1px solid var(--line-soft,#edf2f7); border-radius:8px; overflow:hidden; background:#fff; }
    .dataset-text { padding:12px; margin:0; color:#334155; }
    .dataset-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 12px; background:#f8fafc; border-bottom:1px solid var(--line-soft,#edf2f7); }
    .dataset-head span:first-child { font-weight:800; }
    .dataset-count { color:var(--muted); font-size:12px; }
    .data-table-wrap { overflow-x:auto; }
    .data-table { width:100%; border-collapse:collapse; min-width:560px; font-size:13px; }
    .data-table th, .data-table td { padding:8px 10px; border-bottom:1px solid var(--line-soft,#edf2f7); text-align:left; vertical-align:top; }
    .data-table th { color:#53657d; font-size:12px; font-weight:800; white-space:nowrap; background:#fbfdff; }
    .data-table tr:last-child td { border-bottom:0; }
    .data-table td { color:#243044; }
    .number { font-variant-numeric:tabular-nums; white-space:nowrap; }
    .positive { color:#dc2626; font-weight:800; }
    .negative { color:#059669; font-weight:800; }
    .leader-list { display:grid; gap:8px; padding:12px; }
    .leader-row { display:grid; grid-template-columns:36px minmax(0,1fr) auto; gap:12px; align-items:center; padding:10px 12px; border:1px solid var(--line-soft,#edf2f7); border-radius:8px; background:#fff; }
    .leader-rank { width:28px; height:28px; display:grid; place-items:center; border-radius:50%; background:#eef4ff; color:#31537d; font-size:12px; font-weight:900; }
    .leader-main { min-width:0; }
    .leader-main strong { display:block; line-height:1.35; }
    .leader-meta { color:var(--muted); font-size:12px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .leader-change { font-variant-numeric:tabular-nums; font-size:18px; font-weight:900; white-space:nowrap; }
    .news-list { display:grid; gap:8px; padding:12px; }
    .news-row { display:grid; grid-template-columns:28px minmax(0,1fr); gap:12px; align-items:start; padding:10px 12px; border:1px solid var(--line-soft,#edf2f7); border-radius:8px; background:#fff; }
    .news-rank { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; background:#eef4ff; color:#31537d; font-size:12px; font-weight:900; }
    .news-meta { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:6px; color:var(--muted); font-size:12px; }
    .news-time { color:#48617f; font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .news-tag { border:1px solid var(--line-soft,#edf2f7); border-radius:999px; padding:1px 7px; background:#f8fafc; color:#48617f; }
    .news-title { color:#1f2a3d; line-height:1.5; }
    .news-candidates { margin:4px 12px 12px; border-top:1px dashed var(--line); padding-top:10px; }
    .news-candidates summary { cursor:pointer; color:var(--muted); font-size:13px; font-weight:700; }
    .news-candidate-list { margin:8px 0 0; padding-left:20px; color:#334155; font-size:13px; }
    .news-candidate-list li+li { margin-top:4px; }
    .raw-evidence { margin-top:12px; border-top:1px dashed var(--line); padding-top:10px; }
    .raw-evidence summary { cursor:pointer; color:var(--muted); font-size:13px; font-weight:700; }
    .raw-evidence pre { max-height:260px; overflow:auto; margin:10px 0 0; padding:12px; border-radius:6px; background:#0f172a; color:#dbeafe; font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
    @media(max-width:640px) { .source-top{display:block;} .data-table{min-width:520px;} .leader-row{grid-template-columns:30px minmax(0,1fr);}.leader-change{grid-column:2;font-size:16px;} .news-row{grid-template-columns:24px minmax(0,1fr);gap:8px;} }
  </style>`;
  return html.replace("</head>", `${styles}</head>`);
}

function parseTitle(value) {
  const link = String(value || "").match(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  if (link) return { url: unesc(link[1]), text: unesc(stripTags(link[2])) };
  return { url: null, text: unesc(stripTags(value)) };
}

function parseMeta(value) {
  const parts = String(value || "").split(" · ");
  return {
    source: parts[0] || "",
    observedAt: parts.slice(1).join(" · ")
  };
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function unesc(v) {
  return String(v ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function esc(v) { return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }

function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", weekday:"short", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${v.weekday} · ${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
