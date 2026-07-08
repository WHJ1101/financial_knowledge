// 声明式 API 路由表（技术设计文档 §7.1）。
// 每条路由 = { method, path 或 pattern, public?, handler }：
// - 「是否公开」是表项显式属性，鉴权不再依赖代码位置约定；除标记 public 的条目外一律先过 auth gate。
// - handler 是纯函数：入参 { req, url, params, body }，返回 { status, body, headers? } 或
//   { raw: true, status, headers, body }（文件下载等非 JSON 响应）。不直接触碰 res，便于独立单测。
import { canImportReport, getAuthSession, login, logoutCookie } from "./services/auth.js";
import { searchStocks, getStockQuote } from "./services/market-data.js";
import { createReport, importReport } from "./services/report-lifecycle.js";
import { runDailyJob, syncCommunitySignals, summarizeSignalSync } from "./services/daily-job.js";
import { getPressureSnapshot, runPressureMonitor } from "./services/pressure-monitor.js";
import { getStatus, getReports, getReport, markReportRead, toggleReportStar, archiveReport, deleteReport } from "./routes/reports.js";
import { getStocks, upsertStock, deleteStock, getPositions, upsertPosition, updatePosition, deletePosition, reanalyzeStock, reanalyzePosition } from "./routes/stocks.js";
import { getIndices, getMarketSnapshot } from "./routes/market.js";
import { deleteQuoteOverride, getBatchQuotes, upsertQuoteOverride } from "./routes/quotes.js";
import { buildExport } from "./routes/export.js";
import { deleteReportAssetLink, getAssetReportLinks, getReportAssetLinks, upsertReportAssetLink } from "./routes/report-assets.js";
import { getDecisions, createDailyDecision } from "./routes/decisions.js";
import { getTasks, createTask, toggleTask, updateTaskSchedule, getLogs } from "./routes/tasks.js";
import { getSignals } from "./routes/signals.js";
import { getSettings, toggleAutomation, updateDailySchedule } from "./routes/settings.js";

const notFound = { status: 404, body: { error: "Not found" } };

export const apiRoutes = [
  // ---- 公开端点（public: true 是唯一豁免鉴权的方式）----
  {
    method: "GET", path: "/api/auth/session", public: true,
    handler: ({ req }) => {
      const s = getAuthSession(req);
      return { status: 200, body: { authenticated: s.authenticated, authRequired: s.authRequired, configured: s.configured, user: s.user } };
    }
  },
  {
    method: "POST", path: "/api/auth/login", public: true,
    handler: ({ body }) => {
      const result = login(body);
      if (!result.ok) return { status: result.statusCode || 401, body: { error: result.error } };
      return { status: 200, body: { authenticated: true, user: result.user }, headers: { "set-cookie": result.cookie } };
    }
  },
  {
    method: "POST", path: "/api/auth/logout", public: true,
    handler: () => ({ status: 200, body: { authenticated: false }, headers: { "set-cookie": logoutCookie() } })
  },
  {
    // 导入走独立 token 鉴权（canImportReport），不吃 session gate。
    method: "POST", path: "/api/reports/import", public: true,
    handler: async ({ req, body }) => {
      if (!canImportReport(req)) return { status: 401, body: { error: "Unauthorized" } };
      return { status: 201, body: { report: await importReport(body) } };
    }
  },

  // ---- 受保护端点 ----
  { method: "GET", path: "/api/status", handler: () => ({ status: 200, body: getStatus() }) },
  { method: "GET", path: "/api/reports", handler: ({ url }) => ({ status: 200, body: { reports: getReports(url.searchParams.get("q"), url.searchParams.get("origin")) } }) },
  { method: "GET", pattern: /^\/api\/reports\/([^/]+)\/assets$/, handler: ({ params }) => ({ status: 200, body: { assets: getReportAssetLinks(params[0]) } }) },
  { method: "POST", pattern: /^\/api\/reports\/([^/]+)\/assets$/, handler: ({ params, body }) => ({ status: 200, body: { asset: upsertReportAssetLink(params[0], body) } }) },
  { method: "DELETE", pattern: /^\/api\/report-asset-links\/([^/]+)$/, handler: ({ params }) => ({ status: 200, body: deleteReportAssetLink(params[0]) }) },
  { method: "GET", pattern: /^\/api\/assets\/([^/]+)\/reports$/, handler: ({ params }) => ({ status: 200, body: { reports: getAssetReportLinks(params[0]) } }) },
  { method: "GET", path: "/api/market/snapshot", handler: () => ({ status: 200, body: getMarketSnapshot() }) },
  { method: "GET", path: "/api/market/indices", handler: () => ({ status: 200, body: { indices: getIndices() } }) },
  {
    method: "GET", path: "/api/search",
    handler: async ({ url }) => {
      const q = url.searchParams.get("q");
      if (!q) return { status: 400, body: { error: "q required" } };
      return { status: 200, body: { results: await searchStocks(q) } };
    }
  },
  { method: "POST", path: "/api/quotes/batch", handler: async ({ body }) => ({ status: 200, body: { quotes: await getBatchQuotes(body.items || body.codes || []) } }) },
  { method: "POST", path: "/api/quote-overrides", handler: ({ body }) => ({ status: 200, body: { quote: upsertQuoteOverride(body) } }) },
  { method: "DELETE", pattern: /^\/api\/quote-overrides\/(.+)$/, handler: ({ params }) => ({ status: 200, body: deleteQuoteOverride(params[0]) }) },
  {
    method: "GET", pattern: /^\/api\/quote\/(.+)$/,
    handler: async ({ params }) => {
      const quote = await getStockQuote(params[0]);
      return quote ? { status: 200, body: quote } : notFound;
    }
  },
  { method: "GET", path: "/api/stocks", handler: () => ({ status: 200, body: { stocks: getStocks() } }) },
  { method: "GET", path: "/api/positions", handler: () => ({ status: 200, body: { positions: getPositions() } }) },
  { method: "GET", path: "/api/decisions", handler: () => ({ status: 200, body: { decisions: getDecisions() } }) },
  {
    method: "GET", path: "/api/signals",
    handler: ({ url }) => ({
      status: 200,
      body: { signals: getSignals({ date: url.searchParams.get("date"), status: url.searchParams.get("status"), source: url.searchParams.get("source"), limit: url.searchParams.get("limit") }) }
    })
  },
  { method: "GET", path: "/api/automation/tasks", handler: () => ({ status: 200, body: { tasks: getTasks() } }) },
  { method: "GET", path: "/api/logs", handler: () => ({ status: 200, body: { logs: getLogs() } }) },
  { method: "GET", path: "/api/settings", handler: () => ({ status: 200, body: { settings: getSettings() } }) },
  { method: "GET", path: "/api/pressure", handler: () => ({ status: 200, body: { themes: getPressureSnapshot() } }) },
  {
    method: "GET", pattern: /^\/api\/export\/(positions|reports)\.(csv|json)$/,
    handler: ({ params }) => {
      const payload = buildExport(params[0], params[1]);
      return {
        raw: true,
        status: 200,
        headers: {
          "content-type": payload.contentType,
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${payload.filename}"`
        },
        body: payload.body
      };
    }
  },

  // Report detail
  {
    method: "GET", pattern: /^\/api\/reports\/([^/]+)$/,
    handler: ({ params }) => { const r = getReport(params[0]); return r ? { status: 200, body: { report: r } } : notFound; }
  },
  {
    method: "POST", pattern: /^\/api\/reports\/([^/]+)$/,
    handler: ({ params }) => { const r = markReportRead(params[0]); return r ? { status: 200, body: { report: r } } : notFound; }
  },
  {
    method: "DELETE", pattern: /^\/api\/reports\/([^/]+)$/,
    handler: ({ params }) => { const r = deleteReport(params[0]); return r ? { status: 200, body: r } : notFound; }
  },
  { method: "POST", pattern: /^\/api\/reports\/([^/]+)\/star$/, handler: ({ params }) => ({ status: 200, body: { report: toggleReportStar(params[0]) } }) },
  { method: "POST", pattern: /^\/api\/reports\/([^/]+)\/archive$/, handler: ({ params }) => ({ status: 200, body: { report: archiveReport(params[0]) } }) },

  // Research / jobs
  { method: "POST", path: "/api/research", handler: async ({ body }) => ({ status: 201, body: { report: await createReport(body) } }) },
  { method: "POST", path: "/api/jobs/daily", handler: async () => ({ status: 201, body: await runDailyJob("daily") }) },
  { method: "POST", path: "/api/pressure/sync", handler: async () => ({ status: 201, body: await runPressureMonitor({ source: "manual" }) }) },
  {
    method: "POST", path: "/api/signals/sync",
    handler: async ({ body }) => {
      const result = await syncCommunitySignals({ source: "manual", force: !!body?.force });
      return { status: 201, body: { result: summarizeSignalSync(result) } };
    }
  },

  // Stocks / positions
  { method: "POST", path: "/api/stocks", handler: ({ body }) => ({ status: 201, body: { stock: upsertStock(body) } }) },
  { method: "POST", pattern: /^\/api\/stocks\/([^/]+)\/analyze$/, handler: ({ params }) => ({ status: 200, body: reanalyzeStock(params[0]) }) },
  { method: "DELETE", pattern: /^\/api\/stocks\/([^/]+)$/, handler: ({ params }) => ({ status: 200, body: deleteStock(params[0]) }) },
  { method: "POST", path: "/api/positions", handler: ({ body }) => ({ status: 201, body: { position: upsertPosition(body) } }) },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/analyze$/, handler: ({ params }) => ({ status: 200, body: reanalyzePosition(params[0]) }) },
  { method: "PUT", pattern: /^\/api\/positions\/([^/]+)$/, handler: ({ params, body }) => ({ status: 200, body: { position: updatePosition(params[0], body) } }) },
  { method: "DELETE", pattern: /^\/api\/positions\/([^/]+)$/, handler: ({ params }) => ({ status: 200, body: deletePosition(params[0]) }) },

  // Decisions
  { method: "POST", path: "/api/decisions/daily", handler: () => ({ status: 201, body: { decision: createDailyDecision() } }) },

  // Tasks
  { method: "POST", path: "/api/automation/tasks", handler: ({ body }) => ({ status: 201, body: { task: createTask(body) } }) },
  { method: "POST", pattern: /^\/api\/automation\/tasks\/([^/]+)\/schedule$/, handler: ({ params, body }) => ({ status: 200, body: { task: updateTaskSchedule(params[0], body) } }) },
  { method: "POST", pattern: /^\/api\/automation\/tasks\/([^/]+)\/toggle$/, handler: ({ params }) => ({ status: 200, body: { task: toggleTask(params[0]) } }) },

  // Settings
  { method: "POST", path: "/api/automation/toggle", handler: ({ body }) => ({ status: 200, body: { settings: toggleAutomation(body) } }) },
  { method: "POST", path: "/api/settings/daily-schedule", handler: ({ body }) => ({ status: 200, body: { settings: updateDailySchedule(body) } }) }
];

export function matchApiRoute(method, pathname) {
  for (const route of apiRoutes) {
    if (route.method !== method) continue;
    if (route.path) {
      if (route.path === pathname) return { route, params: [] };
      continue;
    }
    const match = route.pattern.exec(pathname);
    if (match) return { route, params: match.slice(1).map(decodeParam) };
  }
  return null;
}

function decodeParam(v) { try { return decodeURIComponent(v); } catch { return v; } }
