import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve, sep } from "node:path";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import db, { DATA_DIR } from "./services/db.js";
import { startMarketPoller } from "./services/market-data.js";
import { startScheduler } from "./services/scheduler.js";
import { getStatus, getReports, getReport, markReportRead, toggleReportStar, archiveReport, insertReport, getAllReportsForPipeline } from "./routes/reports.js";
import { getStocks, upsertStock, deleteStock, getPositions, upsertPosition, deletePosition } from "./routes/stocks.js";
import { getIndices, getMarketSnapshot } from "./routes/market.js";
import { getDecisions, createDailyDecision } from "./routes/decisions.js";
import { getTasks, createTask, toggleTask, getLogs } from "./routes/tasks.js";
import { getSettings, toggleAutomation } from "./routes/settings.js";
import { renderReportHtml } from "./templates/report.js";
import { runResearchPipeline } from "../lib/researchPipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
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
    if (url.pathname.startsWith("/reports/")) { await serveFile(res, REPORT_DIR, decodeURIComponent(url.pathname.replace("/reports/", ""))); return; }
    await serveFile(res, DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  } catch (e) {
    const code = e.statusCode || 500;
    json(res, code, { error: code === 500 ? "Internal Server Error" : e.message });
    if (code === 500) console.error(e);
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Thinking MVP v0.2 at http://127.0.0.1:${PORT}`));

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;

  if (m === "GET" && p === "/api/status") return json(res, 200, getStatus());
  if (m === "GET" && p === "/api/reports") return json(res, 200, { reports: getReports(url.searchParams.get("q"), url.searchParams.get("origin")) });
  if (m === "GET" && p === "/api/market/snapshot") return json(res, 200, getMarketSnapshot());
  if (m === "GET" && p === "/api/market/indices") return json(res, 200, { indices: getIndices() });
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
  const stockDel = p.match(/^\/api\/stocks\/([^/]+)$/);
  if (m === "DELETE" && stockDel) return json(res, 200, deleteStock(decode(stockDel[1])));
  if (m === "POST" && p === "/api/positions") { const body = await readBody(req); return json(res, 201, { position: upsertPosition(body) }); }
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
function json(res, code, data) { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); }
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
