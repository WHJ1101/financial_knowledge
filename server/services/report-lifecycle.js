// Report Lifecycle Module（技术设计文档 §3.2）：
// 统一「创建 / 导入 / 日更简报」三条报告构建路径的写 HTML、写 DB、写日志。
// HTTP 层（server/index.js + api-routes.js）只做分发，不再持有构建逻辑。
import { createHash } from "node:crypto";

import db, { DATA_DIR } from "./db.js";
import { appendLog } from "./logs.js";
import { buildReportFile, writeReportFile } from "./report-file-store.js";
import { getStockQuote } from "./market-data.js";
import { getAllReportsForPipeline, insertReport } from "../routes/reports.js";
import { renderReportHtml } from "../templates/report.js";
import { runResearchPipeline } from "../../lib/researchPipeline.js";
import { runDailyMarketBriefingPipeline } from "../../lib/dailyMarketBriefingPipeline.js";
import { localDate } from "../../lib/datetime.js";

export const REPORT_TYPES = {
  industry: { label: "产业链深度", path: "investing/themes", accent: "#00a676" },
  market: { label: "市场快览", path: "feeds/market", accent: "#2563eb" },
  stock: { label: "个股跟踪", path: "investing/stocks", accent: "#d97706" },
  policy: { label: "政策扫描", path: "feeds/policy", accent: "#7c3aed" },
  custom: { label: "主题调研", path: "research/themes", accent: "#0f766e" }
};

export async function saveReport({ report, html, logType, logMessage, logMeta = {} }) {
  if (!report?.file) throw Object.assign(new Error("report.file required"), { statusCode: 500 });
  await writeReportFile(report.file, html);
  insertReport(report);
  if (logType) {
    appendLog(logType, logMessage || "Saved report: " + report.title, { id: report.id, ...logMeta });
  }
  return report;
}

export async function createReport({ topic, type, source = "manual" }) {
  if (!topic) throw Object.assign(new Error("topic is required"), { statusCode: 400 });
  type = REPORT_TYPES[type] ? type : inferType(topic);
  const reportType = REPORT_TYPES[type];
  const origin = ["scheduled", "daily", "automation"].includes(source) ? "automation" : "manual";
  const now = new Date().toISOString();
  const localDay = localDate();
  const title = buildTitle(topic, type, localDay);
  const existing = origin === "automation" ? findExistingAutomationReport({ localDay, title, topic, type }) : null;
  const createdAt = existing?.created_at || now;
  const id = existing?.id || buildId(localDay, topic, type);
  const file = buildReportFile(localDay, id);

  const previousReports = getAllReportsForPipeline();
  const brief = await runResearchPipeline({ topic, type, previousReports, dataDir: DATA_DIR });

  const report = {
    id, title, topic, type,
    typeLabel: reportType.label, summary: brief.summary,
    tags: brief.tags, status: existing?.status || "new", source, origin,
    originLabel: origin === "automation" ? "自动化产出" : "手动产出",
    localDate: localDay, file, wikiPath: `${reportType.path}/${localDay}-${slugify(topic)}.html`,
    accent: reportType.accent, highlights: brief.highlights,
    starred: existing?.starred || 0, archived: existing?.archived || 0,
    createdAt, updatedAt: now
  };

  const html = renderReportHtml(report, brief);
  return saveReport({
    report,
    html,
    logType: "research",
    logMessage: "Created report: " + report.title
  });
}

export async function importReport(body = {}) {
  const title = String(body.title || body.topic || "").trim();
  const topic = String(body.topic || title).trim();
  if (!title || !topic) throw Object.assign(new Error("title or topic is required"), { statusCode: 400 });

  const type = REPORT_TYPES[body.type] ? body.type : inferType(`${title} ${topic}`);
  const reportType = REPORT_TYPES[type];
  const createdAt = body.createdAt ? new Date(body.createdAt).toISOString() : new Date().toISOString();
  const localDay = /^\d{4}-\d{2}-\d{2}$/.test(body.localDate || "") ? body.localDate : localDate(new Date(createdAt));
  const id = body.id ? safeId(body.id) : buildId(localDay, topic, type);
  const file = buildReportFile(localDay, id);
  const source = String(body.source || "chat").trim();
  const origin = ["scheduled", "daily", "automation"].includes(source) || body.origin === "automation" ? "automation" : "manual";
  const tags = normalizeList(body.tags);
  const highlights = normalizeList(body.highlights);

  const report = {
    id, title, topic, type,
    typeLabel: reportType.label,
    summary: String(body.summary || "").trim() || `${title} 已通过外部入口导入知识库。`,
    tags, status: body.status || "new", source, origin,
    originLabel: origin === "automation" ? "自动化产出" : "手动产出",
    localDate: localDay, file,
    wikiPath: body.wikiPath || `${reportType.path}/${localDay}-${slugify(topic)}.html`,
    accent: reportType.accent, highlights,
    createdAt, updatedAt: body.updatedAt ? new Date(body.updatedAt).toISOString() : createdAt
  };

  const brief = {
    summary: report.summary,
    highlights,
    watchList: normalizeList(body.watchList),
    risks: normalizeList(body.risks),
    nextSteps: normalizeList(body.nextSteps),
    evidence: Array.isArray(body.evidence) ? body.evidence : [],
    dataQuality: [{ name: "导入来源", status: source === "chat" ? "Codex 对话手动入库" : source }]
  };

  const html = normalizeImportedHtml(body, report, brief);
  return saveReport({
    report,
    html,
    logType: "report_import",
    logMessage: "Imported report: " + report.title,
    logMeta: { source }
  });
}

export async function createDailyMarketBriefReport({ source = "scheduled", now = new Date(), communitySignals = [], signalSync = null } = {}) {
  const type = "market";
  const reportType = REPORT_TYPES[type];
  const origin = "automation";
  const nowIso = now.toISOString();
  const localDay = localDate(now);
  const topic = "每日市场简报";
  const title = `${localDay} 每日市场简报`;
  const existing = findExistingAutomationReport({ localDay, title, topic, type });
  const createdAt = existing?.created_at || nowIso;
  const id = existing?.id || `${localDay}-daily-briefing-${createHash("sha1").update(`${title}-${nowIso}`).digest("hex").slice(0, 8)}`;
  const file = buildReportFile(localDay, id);
  const positions = db.prepare("SELECT * FROM positions ORDER BY updated_at DESC").all();

  const brief = await runDailyMarketBriefingPipeline({
    now,
    positions,
    quoteFetcher: getStockQuote,
    communitySignals,
    signalSync
  });

  const report = {
    id, title, topic, type,
    typeLabel: "每日简报",
    summary: brief.summary,
    tags: brief.tags,
    status: existing?.status || "new",
    source,
    origin,
    originLabel: "自动化产出",
    localDate: localDay,
    file,
    wikiPath: `${reportType.path}/${localDay}-daily-briefing.html`,
    accent: reportType.accent,
    highlights: brief.highlights,
    starred: existing?.starred || 0,
    archived: existing?.archived || 0,
    createdAt,
    updatedAt: nowIso,
    briefingWindow: {
      start: brief.window?.start?.toISOString?.() || null,
      end: brief.window?.end?.toISOString?.() || null,
      timezone: brief.window?.timezone || "Asia/Shanghai"
    },
    sourceStats: brief.dataQuality || []
  };

  const html = renderReportHtml(report, brief);
  return saveReport({
    report,
    html,
    logType: "daily_market_briefing",
    logMessage: "Created report: " + report.title,
    logMeta: { window: report.briefingWindow }
  });
}

function findExistingAutomationReport({ localDay, title, topic, type }) {
  return db.prepare(`
    SELECT * FROM reports
    WHERE local_date=? AND title=? AND topic=? AND type=? AND origin='automation'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(localDay, title, topic, type);
}

function buildId(date, topic, type) { const hash = createHash("sha1").update(`${topic}-${type}-${Date.now()}`).digest("hex").slice(0, 8); return `${date}-${type}-${slugify(topic).slice(0, 48)}-${hash}`; }
function slugify(s) { return String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function buildTitle(topic, type, date) { const s = { industry: "产业链深度", market: "市场复盘", stock: "个股跟踪", policy: "政策日报", custom: "主题调研" }[type] || "主题调研"; return topic.includes(date) || topic.includes(s) ? topic : `${topic} - ${s}`; }
function inferType(topic) { if (/政策|监管|发改委|工信部|财政/.test(topic)) return "policy"; if (/A股|美股|市场|指数|成交|风格|复盘/.test(topic)) return "market"; if (/[（(]?\d{6}[）)]?|个股|公司|财报/.test(topic)) return "stock"; if (/产业|链|材料|算力|半导体|光模块|AI|新能源/.test(topic)) return "industry"; return "custom"; }

function normalizeImportedHtml(body, report, brief) {
  const html = String(body.html || "").trim();
  if (html) return /^<!doctype html|<html[\s>]/i.test(html) ? html : wrapHtmlFragment(report, html);
  const content = String(body.content || body.markdown || "").trim();
  if (content) return wrapHtmlFragment(report, `<pre>${escapeHtml(content)}</pre>`);
  return renderReportHtml(report, brief);
}

function wrapHtmlFragment(report, fragment) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { margin:0; background:#f7fafc; color:#111827; font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; line-height:1.72; }
    main { max-width:920px; margin:0 auto; padding:44px 24px 72px; }
    article { background:#fff; border:1px solid #dbe4f0; border-radius:8px; padding:34px; }
    h1 { margin:0 0 12px; font-size:36px; line-height:1.15; }
    .meta { color:#64748b; font-size:14px; margin-bottom:28px; }
    pre { white-space:pre-wrap; word-break:break-word; font-family:inherit; margin:0; }
    @media(max-width:640px) { main{padding:20px 12px 40px;} article{padding:24px 18px;} h1{font-size:28px;} }
  </style>
</head>
<body><main><article>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">${escapeHtml(report.originLabel)} · ${escapeHtml(report.typeLabel)} · ${escapeHtml(report.localDate)}</p>
  ${fragment}
</article></main></body></html>`;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean);
}

function safeId(value) {
  const id = String(value || "").trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!id) throw Object.assign(new Error("invalid report id"), { statusCode: 400 });
  return id;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
