import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve, sep } from "node:path";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import db, { DATA_DIR } from "./services/db.js";
import { canImportReport, getAuthSession, login, logoutCookie } from "./services/auth.js";
import { startMarketPoller, searchStocks, getStockQuote } from "./services/market-data.js";
import { startScheduler } from "./services/scheduler.js";
import { getStatus, getReports, getReport, markReportRead, toggleReportStar, archiveReport, insertReport, getAllReportsForPipeline } from "./routes/reports.js";
import { getStocks, upsertStock, deleteStock, getPositions, upsertPosition, deletePosition, reanalyzeStock, reanalyzePosition } from "./routes/stocks.js";
import { getIndices, getMarketSnapshot } from "./routes/market.js";
import { getDecisions, createDailyDecision } from "./routes/decisions.js";
import { getTasks, createTask, toggleTask, getLogs } from "./routes/tasks.js";
import { getSettings, toggleAutomation } from "./routes/settings.js";
import { renderReportHtml } from "./templates/report.js";
import { runResearchPipeline } from "../lib/researchPipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const REPORT_DIR = join(DATA_DIR, "reports");
const DIST_DIR = join(__dirname, "../dist");

const REPORT_TYPES = {
  industry: { label: "产业链深度", path: "investing/themes", accent: "#00a676" },
  market: { label: "市场快览", path: "feeds/market", accent: "#2563eb" },
  stock: { label: "个股跟踪", path: "investing/stocks", accent: "#d97706" },
  policy: { label: "政策扫描", path: "feeds/policy", accent: "#7c3aed" },
  custom: { label: "主题调研", path: "research/themes", accent: "#0f766e" }
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

await mkdir(REPORT_DIR, { recursive: true });
startMarketPoller();
startScheduler(runDailyJob);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) { await handleApi(req, res, url); return; }
    if (url.pathname.startsWith("/reports/")) {
      if (!requirePageAuth(req, res)) return;
      await serveFile(res, REPORT_DIR, decodeURIComponent(url.pathname.replace("/reports/", "")));
      return;
    }
    await serveFile(res, DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  } catch (e) {
    const code = e.statusCode || 500;
    json(res, code, { error: code === 500 ? "Internal Server Error" : e.message });
    if (code === 500) console.error(e);
  }
});

server.listen(PORT, HOST, () => console.log(`Financial Knowledge at http://${HOST}:${PORT}`));

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;

  if (m === "GET" && p === "/api/auth/session") {
    const session = getAuthSession(req);
    return json(res, 200, {
      authenticated: session.authenticated,
      authRequired: session.authRequired,
      configured: session.configured,
      user: session.user
    });
  }
  if (m === "POST" && p === "/api/auth/login") {
    const result = login(await readBody(req));
    if (!result.ok) return json(res, result.statusCode || 401, { error: result.error });
    return json(res, 200, { authenticated: true, user: result.user }, { "set-cookie": result.cookie });
  }
  if (m === "POST" && p === "/api/auth/logout") {
    return json(res, 200, { authenticated: false }, { "set-cookie": logoutCookie() });
  }

  if (m === "POST" && p === "/api/reports/import") {
    if (!canImportReport(req)) return json(res, 401, { error: "Unauthorized" });
    const body = await readBody(req);
    return json(res, 201, { report: await importReport(body) });
  }

  if (!requireApiAuth(req, res)) return;

  if (m === "GET" && p === "/api/status") return json(res, 200, getStatus());
  if (m === "GET" && p === "/api/reports") return json(res, 200, { reports: getReports(url.searchParams.get("q"), url.searchParams.get("origin")) });
  if (m === "GET" && p === "/api/market/snapshot") return json(res, 200, getMarketSnapshot());
  if (m === "GET" && p === "/api/market/indices") return json(res, 200, { indices: getIndices() });
  if (m === "GET" && p === "/api/search") { const q = url.searchParams.get("q"); if (!q) return json(res, 400, { error: "q required" }); return json(res, 200, { results: await searchStocks(q) }); }
  const quoteMatch = p.match(/^\/api\/quote\/(.+)$/);
  if (m === "GET" && quoteMatch) { const quote = await getStockQuote(decode(quoteMatch[1])); return quote ? json(res, 200, quote) : json(res, 404, { error: "Not found" }); }
  if (m === "GET" && p === "/api/stocks") return json(res, 200, { stocks: getStocks() });
  if (m === "GET" && p === "/api/positions") return json(res, 200, { positions: getPositions() });
  if (m === "GET" && p === "/api/decisions") return json(res, 200, { decisions: getDecisions() });
  if (m === "GET" && p === "/api/automation/tasks") return json(res, 200, { tasks: getTasks() });
  if (m === "GET" && p === "/api/logs") return json(res, 200, { logs: getLogs() });
  if (m === "GET" && p === "/api/settings") return json(res, 200, { settings: getSettings() });

  // Report detail
  const reportMatch = p.match(/^\/api\/reports\/([^/]+)$/);
  if (m === "GET" && reportMatch) { const r = getReport(decode(reportMatch[1])); return r ? json(res, 200, { report: r }) : json(res, 404, { error: "Not found" }); }
  if (m === "POST" && reportMatch) { const r = markReportRead(decode(reportMatch[1])); return r ? json(res, 200, { report: r }) : json(res, 404, { error: "Not found" }); }

  // Report star/archive
  const starMatch = p.match(/^\/api\/reports\/([^/]+)\/star$/);
  if (m === "POST" && starMatch) { const r = toggleReportStar(decode(starMatch[1])); return json(res, 200, { report: r }); }
  const archiveMatch = p.match(/^\/api\/reports\/([^/]+)\/archive$/);
  if (m === "POST" && archiveMatch) { const r = archiveReport(decode(archiveMatch[1])); return json(res, 200, { report: r }); }

  // Research
  if (m === "POST" && p === "/api/research") { const body = await readBody(req); return json(res, 201, { report: await createReport(body) }); }
  if (m === "POST" && p === "/api/jobs/daily") { return json(res, 201, await runDailyJob("daily")); }

  // Stocks/Positions
  if (m === "POST" && p === "/api/stocks") { const body = await readBody(req); return json(res, 201, { stock: upsertStock(body) }); }
  const stockAnalyze = p.match(/^\/api\/stocks\/([^/]+)\/analyze$/);
  if (m === "POST" && stockAnalyze) return json(res, 200, reanalyzeStock(decode(stockAnalyze[1])));
  const stockDel = p.match(/^\/api\/stocks\/([^/]+)$/);
  if (m === "DELETE" && stockDel) return json(res, 200, deleteStock(decode(stockDel[1])));
  if (m === "POST" && p === "/api/positions") { const body = await readBody(req); return json(res, 201, { position: upsertPosition(body) }); }
  const posAnalyze = p.match(/^\/api\/positions\/([^/]+)\/analyze$/);
  if (m === "POST" && posAnalyze) return json(res, 200, reanalyzePosition(decode(posAnalyze[1])));
  const posDel = p.match(/^\/api\/positions\/([^/]+)$/);
  if (m === "DELETE" && posDel) return json(res, 200, deletePosition(decode(posDel[1])));

  // Decisions
  if (m === "POST" && p === "/api/decisions/daily") return json(res, 201, { decision: createDailyDecision() });

  // Tasks
  if (m === "POST" && p === "/api/automation/tasks") { const body = await readBody(req); return json(res, 201, { task: createTask(body) }); }
  const taskToggle = p.match(/^\/api\/automation\/tasks\/([^/]+)\/toggle$/);
  if (m === "POST" && taskToggle) return json(res, 200, { task: toggleTask(decode(taskToggle[1])) });

  // Settings
  if (m === "POST" && p === "/api/automation/toggle") { const body = await readBody(req); return json(res, 200, { settings: toggleAutomation(body) }); }

  json(res, 404, { error: "Not found" });
}

async function createReport({ topic, type, source = "manual" }) {
  if (!topic) throw Object.assign(new Error("topic is required"), { statusCode: 400 });
  type = REPORT_TYPES[type] ? type : inferType(topic);
  const reportType = REPORT_TYPES[type];
  const origin = ["scheduled", "daily", "automation"].includes(source) ? "automation" : "manual";
  const createdAt = new Date().toISOString();
  const localDay = localDate();
  const id = buildId(localDay, topic, type);
  const file = `${localDay}/${id}.html`;

  const previousReports = getAllReportsForPipeline();
  const brief = await runResearchPipeline({ topic, type, previousReports, dataDir: DATA_DIR });

  const report = {
    id, title: buildTitle(topic, type, localDay), topic, type,
    typeLabel: reportType.label, summary: brief.summary,
    tags: brief.tags, status: "new", source, origin,
    originLabel: origin === "automation" ? "自动化产出" : "手动产出",
    localDate: localDay, file, wikiPath: `${reportType.path}/${localDay}-${slugify(topic)}.html`,
    accent: reportType.accent, highlights: brief.highlights,
    createdAt, updatedAt: createdAt
  };

  const html = renderReportHtml(report, brief);
  await mkdir(join(REPORT_DIR, localDay), { recursive: true });
  await writeFile(join(REPORT_DIR, file), html, "utf8");
  insertReport(report);
  appendLog("research", `Created report: ${report.title}`, { id: report.id });
  return report;
}

async function importReport(body = {}) {
  const title = String(body.title || body.topic || "").trim();
  const topic = String(body.topic || title).trim();
  if (!title || !topic) throw Object.assign(new Error("title or topic is required"), { statusCode: 400 });

  const type = REPORT_TYPES[body.type] ? body.type : inferType(`${title} ${topic}`);
  const reportType = REPORT_TYPES[type];
  const createdAt = body.createdAt ? new Date(body.createdAt).toISOString() : new Date().toISOString();
  const localDay = /^\d{4}-\d{2}-\d{2}$/.test(body.localDate || "") ? body.localDate : localDate(new Date(createdAt));
  const id = body.id ? safeId(body.id) : buildId(localDay, topic, type);
  const file = `${localDay}/${id}.html`;
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
  await mkdir(join(REPORT_DIR, localDay), { recursive: true });
  await writeFile(join(REPORT_DIR, file), html, "utf8");
  insertReport(report);
  appendLog("report_import", `Imported report: ${report.title}`, { id: report.id, source });
  return report;
}

async function runDailyJob(source = "scheduled") {
  const today = localDate();
  const settings = getSettings();
  if (source === "scheduled" && settings.lastDailyRun === today) return { skipped: true, reason: "已执行过今日日更", reports: [] };

  const topics = [
    { topic: `${today} A股市场脉搏：成交、风格轮动与资金方向`, type: "market" },
    { topic: "AI算力产业链：光模块、交换芯片与液冷的订单验证", type: "industry" },
    { topic: "半导体材料观察：锗、InP与先进封装需求", type: "industry" },
    { topic: "政策日报：低空经济、算力基础设施与设备更新", type: "policy" }
  ];
  const reports = [];
  for (const item of topics) reports.push(await createReport({ ...item, source }));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyRun", JSON.stringify(today));
  appendLog("daily_job", `Daily job created ${reports.length} reports`, { source });
  return { skipped: false, reports };
}

// Utilities
function json(res, code, data, headers = {}) { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(data)); }
function decode(v) { try { return decodeURIComponent(v); } catch { return v; } }
async function readBody(req) { const c = []; for await (const ch of req) c.push(ch); if (!c.length) return {}; try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); } }

async function serveFile(res, baseDir, reqPath) {
  const base = resolve(baseDir);
  const target = resolve(baseDir, reqPath || "");
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  let s;
  try { s = await stat(target); } catch { if (baseDir === DIST_DIR) { await serveFile(res, DIST_DIR, "index.html"); return; } throw Object.assign(new Error("Not found"), { statusCode: 404 }); }
  if (!s.isFile()) throw Object.assign(new Error("Not found"), { statusCode: 404 });
  res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(await readFile(target));
}

function appendLog(type, message, meta = {}) {
  db.prepare("INSERT INTO logs (id,type,message,meta,created_at,local_time) VALUES (?,?,?,?,?,?)").run(
    `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, message, JSON.stringify(meta), new Date().toISOString(), localDateTime()
  );
}

function localDate(d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
function localDateTime() { const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date()); const v = Object.fromEntries(parts.map(p => [p.type, p.value])); return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`; }
function buildId(date, topic, type) { const hash = createHash("sha1").update(`${topic}-${type}-${Date.now()}`).digest("hex").slice(0, 8); return `${date}-${type}-${slugify(topic).slice(0, 48)}-${hash}`; }
function slugify(s) { return String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function buildTitle(topic, type, date) { const s = { industry: "产业链深度", market: "市场复盘", stock: "个股跟踪", policy: "政策日报", custom: "主题调研" }[type] || "主题调研"; return topic.includes(date) || topic.includes(s) ? topic : `${topic} - ${s}`; }
function inferType(topic) { if (/政策|监管|发改委|工信部|财政/.test(topic)) return "policy"; if (/A股|美股|市场|指数|成交|风格|复盘/.test(topic)) return "market"; if (/[（(]?\d{6}[）)]?|个股|公司|财报/.test(topic)) return "stock"; if (/产业|链|材料|算力|半导体|光模块|AI|新能源/.test(topic)) return "industry"; return "custom"; }

function requireApiAuth(req, res) {
  const session = getAuthSession(req);
  if (session.authenticated) return true;
  json(res, session.configured ? 401 : 503, { error: session.configured ? "Unauthorized" : "登录尚未配置" });
  return false;
}

function requirePageAuth(req, res) {
  const session = getAuthSession(req);
  if (session.authenticated) return true;
  res.writeHead(session.configured ? 401 : 503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(session.configured ? "Unauthorized" : "登录尚未配置");
  return false;
}

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
