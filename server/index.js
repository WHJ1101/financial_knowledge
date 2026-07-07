// HTTP 网关层：只做请求分发、鉴权 gate、静态文件服务。
// API 路由在 api-routes.js 声明；报告构建在 services/report-lifecycle.js；日更编排在 services/daily-job.js。
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";

import { getAuthSession, isAuthRequired } from "./services/auth.js";
import { startMarketPoller } from "./services/market-data.js";
import { startScheduler } from "./services/scheduler.js";
import { runAutomationTask } from "./services/daily-job.js";
import { ensureReportRoot, REPORT_DIR } from "./services/report-file-store.js";
import { modernizeReportHtml } from "./templates/report.js";
import { matchApiRoute } from "./api-routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const DIST_DIR = join(__dirname, "../dist");

// 安全护栏：未配置鉴权时禁止监听对外地址，避免报告 / 持仓 / 可烧钱的 LLM 端点全公网裸奔。
// 需要有意在无鉴权下对外暴露（如内网可信环境），显式设置 FINANCE_KNOWLEDGE_ALLOW_INSECURE_HOST=true 绕过。
function assertHostIsSafe() {
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (isAuthRequired() || loopbackHosts.has(HOST) || process.env.FINANCE_KNOWLEDGE_ALLOW_INSECURE_HOST === "true") return;
  console.error(
    `[安全] 拒绝在 ${HOST}:${PORT} 上以无鉴权模式对外监听。\n` +
    `      请设置 FINANCE_KNOWLEDGE_AUTH_PASSWORD 开启登录，或将 HOST 设为 127.0.0.1 仅本机访问。\n` +
    `      如确需在可信内网无鉴权暴露，显式设置 FINANCE_KNOWLEDGE_ALLOW_INSECURE_HOST=true。`
  );
  process.exit(1);
}
assertHostIsSafe();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

await ensureReportRoot();
startMarketPoller();
startScheduler(runAutomationTask);

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
  const matched = matchApiRoute(req.method, url.pathname);
  if (!matched) return json(res, 404, { error: "Not found" });

  const { route, params } = matched;
  if (!route.public && !requireApiAuth(req, res)) return;

  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
  const result = await route.handler({ req, url, params, body });
  if (result.raw) {
    res.writeHead(result.status, result.headers);
    res.end(result.body);
    return;
  }
  json(res, result.status, result.body, result.headers || {});
}

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

function json(res, code, data, headers = {}) { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(data)); }

async function readBody(req) { const c = []; for await (const ch of req) c.push(ch); if (!c.length) return {}; try { return JSON.parse(Buffer.concat(c).toString()); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); } }

async function serveFile(res, baseDir, reqPath) {
  const base = resolve(baseDir);
  const target = resolve(baseDir, reqPath || "");
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  let s;
  try { s = await stat(target); } catch { if (baseDir === DIST_DIR) { await serveFile(res, DIST_DIR, "index.html"); return; } throw Object.assign(new Error("Not found"), { statusCode: 404 }); }
  if (!s.isFile()) throw Object.assign(new Error("Not found"), { statusCode: 404 });
  const body = await readFile(target);
  const content = baseDir === REPORT_DIR && extname(target) === ".html" ? modernizeReportHtml(body.toString("utf8")) : body;
  res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(content);
}
