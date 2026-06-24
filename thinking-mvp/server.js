import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { runResearchPipeline } from "./lib/researchPipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(__dirname, "public");
const DATA_DIR = join(__dirname, "data");
const REPORT_DIR = join(DATA_DIR, "reports");
const INDEX_FILE = join(DATA_DIR, "reports.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const LOG_FILE = join(DATA_DIR, "logs.json");
const STOCKS_FILE = join(DATA_DIR, "stocks.json");
const POSITIONS_FILE = join(DATA_DIR, "positions.json");
const MARKET_INDICES_FILE = join(DATA_DIR, "market-indices.json");
const AUTOMATION_TASKS_FILE = join(DATA_DIR, "automation-tasks.json");
const DECISIONS_FILE = join(DATA_DIR, "decisions.json");
const TIME_ZONE = "Asia/Shanghai";
const DAILY_JOB_HOUR = 8;
const DAILY_JOB_MINUTE = 30;

const REPORT_TYPES = {
  industry: {
    label: "产业链深度",
    path: "investing/themes",
    accent: "#00a676"
  },
  market: {
    label: "市场快览",
    path: "feeds/market",
    accent: "#2563eb"
  },
  stock: {
    label: "个股跟踪",
    path: "investing/stocks",
    accent: "#d97706"
  },
  policy: {
    label: "政策扫描",
    path: "feeds/policy",
    accent: "#7c3aed"
  },
  custom: {
    label: "主题调研",
    path: "research/themes",
    accent: "#0f766e"
  }
};

const REPORT_ORIGINS = {
  automation: "自动化产出",
  manual: "手动产出"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const DEFAULT_SETTINGS = {
  automationEnabled: false,
  lastDailyRun: null,
  schedule: "08:30 Asia/Shanghai",
  knowledgeStatus: "ok"
};

const DEFAULT_STOCKS = [
  {
    code: "002428",
    name: "云南锗业",
    market: "A股",
    status: "观察",
    thesis: "半导体材料与锗资源弹性标的，需跟踪价格、订单和政策催化。",
    advice: "等待基本面和交易拥挤度进一步验证。",
    risk: "资源品价格波动大，主题交易回撤风险高。",
    watchSignals: ["锗价格", "成交额变化", "公告与业绩预告"],
    sparkline: [8, 11, 9, 14, 12, 16, 13, 15]
  }
];

const DEFAULT_POSITIONS = [];

const DEFAULT_MARKET_INDICES = [
  {
    region: "A股",
    name: "上证指数",
    code: "000001.SH",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["华夏上证50ETF", "华泰柏瑞沪深300ETF", "易方达上证科创板50ETF"]
  },
  {
    region: "A股",
    name: "深证成指",
    code: "399001.SZ",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["易方达深证100ETF", "南方中证500ETF"]
  },
  {
    region: "A股",
    name: "创业板指",
    code: "399006.SZ",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["易方达创业板ETF", "华安创业板50ETF"]
  },
  {
    region: "A股",
    name: "科创50",
    code: "000688.SH",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["华夏科创50ETF", "易方达科创板50ETF"]
  },
  {
    region: "港股",
    name: "恒生指数",
    code: "HSI.HK",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["华夏恒生ETF", "易方达恒生H股ETF"]
  },
  {
    region: "美股",
    name: "纳斯达克综合指数",
    code: "IXIC.US",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["广发纳指100ETF", "国泰纳斯达克100ETF"]
  },
  {
    region: "美股",
    name: "标普500",
    code: "SPX.US",
    level: "待接入",
    change: "待接入",
    relatedEtfs: ["博时标普500ETF", "易方达标普500ETF"]
  }
];

const DEFAULT_AUTOMATION_TASKS = [
  {
    id: "daily-research",
    name: "每日投研日更",
    enabled: true,
    goal: "每天生成市场、产业链和政策相关报告。",
    implementation: "调用内置日更任务，生成网页报告并写入本地资料库。",
    prompt: "请基于市场、产业链、政策三个维度生成每日投研简报，明确证据、风险和下一步跟踪动作。",
    schedule: "08:30 中国标准时间",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

await ensureStore();
await seedIfEmpty();
await migrateReportOrigins();
startScheduler();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/reports/")) {
      const relativePath = decodeURIComponent(url.pathname.replace("/reports/", ""));
      await serveFile(res, REPORT_DIR, relativePath);
      return;
    }

    const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    await serveFile(res, PUBLIC_DIR, staticPath);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: statusCode === 500 ? "Internal Server Error" : error.message
    });
    if (statusCode === 500) {
      console.error(error);
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Thinking MVP running at http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    const reports = await readReports();
    const settings = await readSettings();
    const today = localDate();
    const sevenDaysAgo = startOfLocalDayOffset(-6);
    const originCounts = countReportOrigins(reports);

    sendJson(res, 200, {
      app: "thinking-mvp",
      version: "0.1.0",
      now: localDateTime(),
      todayUpdates: reports.filter((report) => report.localDate === today).length,
      unreadCount: reports.filter((report) => report.status !== "read").length,
      recentCount: reports.filter((report) => new Date(report.createdAt) >= sevenDaysAgo).length,
      reportCount: reports.length,
      originCounts,
      settings
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const originFilter = normalizeReportOriginFilter(url.searchParams.get("origin"));
    const reports = await readReports();
    const filtered = reports.filter((report) => {
      if (originFilter !== "all" && report.origin !== originFilter) return false;
      if (query) {
          const haystack = [
            report.title,
            report.topic,
            report.summary,
            report.originLabel,
            sourceLabel(report.source),
            ...(report.tags || [])
          ].join(" ").toLowerCase();
          return haystack.includes(query);
      }
      return true;
    });
    sendJson(res, 200, { reports: filtered });
    return;
  }

  const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
  if (req.method === "GET" && reportMatch) {
    const report = await findReport(decodeSegment(reportMatch[1]));
    if (!report) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }
    sendJson(res, 200, { report });
    return;
  }

  if (req.method === "POST" && reportMatch) {
    const report = await markReportRead(decodeSegment(reportMatch[1]));
    if (!report) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }
    sendJson(res, 200, { report });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/research") {
    const body = await readBody(req);
    const topic = String(body.topic || "").trim();
    if (!topic) {
      sendJson(res, 400, { error: "topic is required" });
      return;
    }
    const report = await createReport({
      topic,
      type: normalizeType(body.type || inferType(topic)),
      source: "manual"
    });
    await appendLog("manual_research", `Created report: ${report.title}`, {
      reportId: report.id,
      topic
    });
    sendJson(res, 201, { report });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs/daily") {
    const result = await runDailyJob("daily");
    sendJson(res, 201, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/automation/toggle") {
    const body = await readBody(req);
    const settings = await readSettings();
    settings.automationEnabled =
      typeof body.enabled === "boolean" ? body.enabled : !settings.automationEnabled;
    await writeSettings(settings);
    await appendLog(
      "automation",
      settings.automationEnabled ? "Automation enabled" : "Automation paused",
      { schedule: settings.schedule }
    );
    sendJson(res, 200, { settings });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, { logs: await readJson(LOG_FILE, []) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stocks") {
    sendJson(res, 200, { stocks: await readJson(STOCKS_FILE, []) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stocks") {
    const body = await readBody(req);
    const stock = normalizeStockInput(body);
    const stocks = await readJson(STOCKS_FILE, []);
    const next = stocks.filter((item) => item.code !== stock.code);
    next.unshift(stock);
    await writeJson(STOCKS_FILE, next);
    await appendLog("stock", `Saved stock: ${stock.name}`, { code: stock.code });
    sendJson(res, 201, { stock });
    return;
  }

  const stockMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)$/);
  if (req.method === "DELETE" && stockMatch) {
    const code = decodeSegment(stockMatch[1]);
    const stocks = await readJson(STOCKS_FILE, []);
    const next = stocks.filter((item) => item.code !== code);
    await writeJson(STOCKS_FILE, next);
    sendJson(res, 200, { deleted: stocks.length !== next.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/positions") {
    sendJson(res, 200, { positions: await readJson(POSITIONS_FILE, []) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/positions") {
    const body = await readBody(req);
    const position = normalizePositionInput(body);
    const positions = await readJson(POSITIONS_FILE, []);
    const next = positions.filter((item) => item.id !== position.id);
    next.unshift(position);
    await writeJson(POSITIONS_FILE, next);
    await appendLog("position", `Saved position: ${position.name}`, {
      code: position.code,
      shares: position.shares
    });
    sendJson(res, 201, { position });
    return;
  }

  const positionMatch = url.pathname.match(/^\/api\/positions\/([^/]+)$/);
  if (req.method === "DELETE" && positionMatch) {
    const id = decodeSegment(positionMatch[1]);
    const positions = await readJson(POSITIONS_FILE, []);
    const next = positions.filter((item) => item.id !== id);
    await writeJson(POSITIONS_FILE, next);
    sendJson(res, 200, { deleted: positions.length !== next.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market-indices") {
    sendJson(res, 200, { indices: await readJson(MARKET_INDICES_FILE, DEFAULT_MARKET_INDICES) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/automation/tasks") {
    sendJson(res, 200, { tasks: await readJson(AUTOMATION_TASKS_FILE, DEFAULT_AUTOMATION_TASKS) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/automation/tasks") {
    const body = await readBody(req);
    const task = normalizeAutomationTaskInput(body);
    const tasks = await readJson(AUTOMATION_TASKS_FILE, DEFAULT_AUTOMATION_TASKS);
    tasks.unshift(task);
    await writeJson(AUTOMATION_TASKS_FILE, tasks);
    await appendLog("automation_task", `Created automation task: ${task.name}`, { id: task.id });
    sendJson(res, 201, { task });
    return;
  }

  const automationTaskMatch = url.pathname.match(/^\/api\/automation\/tasks\/([^/]+)\/toggle$/);
  if (req.method === "POST" && automationTaskMatch) {
    const id = decodeSegment(automationTaskMatch[1]);
    const tasks = await readJson(AUTOMATION_TASKS_FILE, DEFAULT_AUTOMATION_TASKS);
    const task = tasks.find((item) => item.id === id);
    if (!task) {
      sendJson(res, 404, { error: "Automation task not found" });
      return;
    }
    task.enabled = !task.enabled;
    task.updatedAt = new Date().toISOString();
    await writeJson(AUTOMATION_TASKS_FILE, tasks);
    sendJson(res, 200, { task });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/decisions") {
    sendJson(res, 200, { decisions: await readJson(DECISIONS_FILE, []) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/decisions/daily") {
    const decision = await createDailyDecisionGuide();
    sendJson(res, 201, { decision });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function normalizeStockInput(body) {
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  if (!code || !name) {
    const error = new Error("股票代码和名称必填");
    error.statusCode = 400;
    throw error;
  }
  return {
    code,
    name,
    market: String(body.market || "A股").trim(),
    status: String(body.status || "观察").trim(),
    thesis: String(body.thesis || "等待补充关注理由。").trim(),
    advice: String(body.advice || "暂不形成明确操作建议，继续跟踪。").trim(),
    risk: String(body.risk || "需补充风险提示。").trim(),
    watchSignals: normalizeList(body.watchSignals || "公告、成交额、财报"),
    sparkline: Array.isArray(body.sparkline)
      ? body.sparkline.map(Number).filter(Number.isFinite).slice(0, 12)
      : buildDefaultSparkline(code),
    updatedAt: new Date().toISOString()
  };
}

function normalizePositionInput(body) {
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  if (!code || !name) {
    const error = new Error("持仓代码和名称必填");
    error.statusCode = 400;
    throw error;
  }
  const shares = Number(body.shares || 0);
  const cost = Number(body.cost || 0);
  return {
    id: String(body.id || `${code}-${Date.now()}`),
    code,
    name,
    market: String(body.market || "A股").trim(),
    shares: Number.isFinite(shares) ? shares : 0,
    cost: Number.isFinite(cost) ? cost : 0,
    reason: String(body.reason || "等待补充持仓理由。").trim(),
    risk: String(body.risk || "需补充退出条件和风险提示。").trim(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeAutomationTaskInput(body) {
  const name = String(body.name || "").trim();
  const goal = String(body.goal || "").trim();
  const implementation = String(body.implementation || "").trim();
  if (!name || !goal || !implementation) {
    const error = new Error("任务名称、任务目标和执行实现必填");
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  return {
    id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    enabled: false,
    goal,
    implementation,
    prompt: optimizeAutomationPrompt({ name, goal, implementation }),
    schedule: String(body.schedule || "手动触发").trim(),
    createdAt: now,
    updatedAt: now
  };
}

async function createDailyDecisionGuide() {
  const [stocks, positions, indices, reports, decisions] = await Promise.all([
    readJson(STOCKS_FILE, []),
    readJson(POSITIONS_FILE, []),
    readJson(MARKET_INDICES_FILE, DEFAULT_MARKET_INDICES),
    readReports(),
    readJson(DECISIONS_FILE, [])
  ]);
  const today = localDate();
  const relatedReports = reports.filter((report) => report.localDate === today).slice(0, 8);
  const positionNames = positions.map((item) => `${item.name}(${item.code})`).join("、") || "暂无持仓";
  const stockNames = stocks.map((item) => `${item.name}(${item.code})`).join("、") || "暂无自选股";
  const indexSummary = indices
    .map((item) => `${item.name}：${item.change || "待接入"}`)
    .slice(0, 7)
    .join("；");
  const guide = {
    id: `decision-${today}-${Date.now()}`,
    date: today,
    title: `${today} 每日决策指南`,
    summary: `基于当前自选股、持仓、指数配置和今日报告生成。持仓：${positionNames}。自选：${stockNames}。`,
    action: positions.length ? "优先复核持仓风险，再决定是否新增仓位。" : "当前无持仓，优先观察市场环境和候选标的证据。",
    market: indexSummary,
    positionAdvice: positions.map((item) => ({
      code: item.code,
      name: item.name,
      advice: `复核持仓理由：${item.reason}；风险：${item.risk}`
    })),
    stockAdvice: stocks.map((item) => ({
      code: item.code,
      name: item.name,
      advice: item.advice,
      risk: item.risk
    })),
    reports: relatedReports.map((report) => ({
      id: report.id,
      title: report.title,
      typeLabel: report.typeLabel
    })),
    createdAt: new Date().toISOString()
  };
  decisions.unshift(guide);
  await writeJson(DECISIONS_FILE, decisions.slice(0, 120));
  await appendLog("decision", `Created decision guide: ${guide.title}`, { id: guide.id });
  return guide;
}

function optimizeAutomationPrompt({ name, goal, implementation }) {
  return [
    `任务名称：${name}`,
    `任务目标：${goal}`,
    `执行方式：${implementation}`,
    "请在执行时先收集可复核证据，再输出结论、风险、下一步动作。",
    "输出必须标注数据来源和时间，不得把未验证假设写成确定事实。"
  ].join("\n");
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDefaultSparkline(seed) {
  const base = [...String(seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7;
  return [8, 10, 9, 12, 11, 14, 13, 15].map((value, index) => value + ((base + index) % 4));
}

async function createReport({ topic, type = "custom", source = "manual", origin }) {
  await ensureStore();
  const reportType = REPORT_TYPES[type] || REPORT_TYPES.custom;
  const reportOrigin = normalizeReportOrigin(origin, source);
  const createdAt = new Date().toISOString();
  const localDay = localDate();
  const id = buildReportId(localDay, topic, type);
  const file = `${localDay}/${id}.html`;
  const title = buildTitle(topic, type, localDay);
  const previousReports = await readReports();
  const brief = await runResearchPipeline({
    topic,
    type,
    previousReports,
    dataDir: DATA_DIR
  });
  const report = {
    id,
    title,
    topic,
    type,
    typeLabel: reportType.label,
    summary: brief.summary,
    tags: brief.tags,
    status: "new",
    source,
    origin: reportOrigin,
    originLabel: originLabel(reportOrigin),
    localDate: localDay,
    createdAt,
    updatedAt: createdAt,
    file,
    wikiPath: `${reportType.path}/${localDay}-${slugify(topic)}.html`,
    accent: reportType.accent,
    highlights: brief.highlights
  };

  const html = renderReportHtml(report, brief);
  await mkdir(join(REPORT_DIR, localDay), { recursive: true });
  await writeFile(join(REPORT_DIR, file), html, "utf8");

  const deduped = previousReports.filter((item) => item.id !== id);
  deduped.unshift(report);
  await writeReports(sortReports(deduped));
  return report;
}

async function runDailyJob(source = "scheduled") {
  const today = localDate();
  const settings = await readSettings();

  if (source === "scheduled" && settings.lastDailyRun === today) {
    return { skipped: true, reason: "Daily job already ran today", reports: [] };
  }

  const topics = [
    {
      topic: `${today} A股市场脉搏：成交、风格轮动与资金方向`,
      type: "market"
    },
    {
      topic: "AI算力产业链：光模块、交换芯片与液冷的订单验证",
      type: "industry"
    },
    {
      topic: "半导体材料观察：锗、InP与先进封装需求",
      type: "industry"
    },
    {
      topic: "政策日报：低空经济、算力基础设施与设备更新",
      type: "policy"
    }
  ];

  const reports = [];
  for (const item of topics) {
    reports.push(await createReport({ ...item, source }));
  }

  settings.lastDailyRun = today;
  await writeSettings(settings);
  await appendLog("daily_job", `Daily job created ${reports.length} reports`, {
    source,
    reportIds: reports.map((report) => report.id)
  });
  return { skipped: false, reports };
}

function startScheduler() {
  setInterval(async () => {
    try {
      const settings = await readSettings();
      if (!settings.automationEnabled) return;

      const now = localParts();
      const isAfterSchedule =
        now.hour > DAILY_JOB_HOUR ||
        (now.hour === DAILY_JOB_HOUR && now.minute >= DAILY_JOB_MINUTE);

      if (isAfterSchedule && settings.lastDailyRun !== now.date) {
        await runDailyJob("scheduled");
      }
    } catch (error) {
      console.error("Scheduler failed:", error);
    }
  }, 60_000);
}

function renderReportHtml(report, brief) {
  const generatedAt = localDateTime(new Date(report.createdAt));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --accent: ${report.accent};
      --ink: #111827;
      --muted: #64748b;
      --line: #dbe4f0;
      --soft: #f7fafc;
      --paper: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--soft);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 48px 28px 72px;
    }
    article {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 36px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 10px 0 14px;
      font-size: clamp(30px, 5vw, 48px);
      line-height: 1.1;
      letter-spacing: 0;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
    }
    section {
      border-top: 1px solid var(--line);
      margin-top: 30px;
      padding-top: 24px;
    }
    h2 {
      font-size: 20px;
      margin: 0 0 12px;
    }
    ul {
      padding-left: 22px;
      margin: 10px 0 0;
    }
    li + li { margin-top: 8px; }
    .summary {
      margin-top: 28px;
      padding: 18px 20px;
      border-left: 4px solid var(--accent);
      background: #f8fbff;
      border-radius: 6px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .quality {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px;
      background: #fff;
    }
    .quality b { display: block; }
    .quality span { color: var(--muted); font-size: 13px; }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .tag {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      color: #334155;
      font-size: 13px;
      background: #fff;
    }
    .source-list {
      display: grid;
      gap: 12px;
    }
    .source-item {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px 16px;
      background: #fff;
    }
    .source-item strong {
      display: block;
      margin-bottom: 4px;
    }
    .source-item p {
      margin: 8px 0 0;
      color: #334155;
    }
    .source-meta {
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 640px) {
      main { padding: 20px 12px 40px; }
      article { padding: 24px 18px; }
    }
  </style>
</head>
<body>
  <main>
    <article>
      <div class="eyebrow">${escapeHtml(report.typeLabel)}</div>
      <h1>${escapeHtml(report.title)}</h1>
      <div class="meta">
        <span>生成时间：${escapeHtml(generatedAt)}</span>
        <span>产出方式：${escapeHtml(originLabel(report.origin))}</span>
        <span>来源：${escapeHtml(sourceLabel(report.source))}</span>
        <span>${escapeHtml(displayArchivePath(report))}</span>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(originLabel(report.origin))}</span>
        ${(report.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>

      <p class="summary">${escapeHtml(brief.summary)}</p>

      ${renderEvidenceSection(brief.evidence)}

      <section>
        <h2>核心观察</h2>
        ${renderList(brief.highlights)}
      </section>

      <section>
        <h2>跟踪清单</h2>
        ${renderList(brief.watchList)}
      </section>

      <section>
        <h2>风险与反证</h2>
        ${renderList(brief.risks)}
      </section>

      <section>
        <h2>下一步</h2>
        ${renderList(brief.nextSteps)}
      </section>

      <section>
        <h2>系统状态</h2>
        <div class="grid">
          ${brief.dataQuality
            .map(
              (item) => `<div class="quality"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(
                item.status
              )}</span></div>`
            )
            .join("")}
        </div>
      </section>
    </article>
  </main>
</body>
</html>`;
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderEvidenceSection(evidence = []) {
  if (!evidence.length) {
    return `<section><h2>数据源证据</h2><p>尚未采集到外部或本地数据源。请配置本地数据目录或在线数据源。</p></section>`;
  }

  return `<section>
    <h2>数据源证据</h2>
    <div class="source-list">
      ${evidence.map(renderEvidenceItem).join("")}
    </div>
  </section>`;
}

function renderEvidenceItem(item) {
  const meta = [
    displayEvidenceSource(item.source),
    item.observedAt ? `时间：${item.observedAt}` : null,
    item.confidence ? `可信度：${displayConfidence(item.confidence)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
  const href = safeEvidenceHref(item.url);
  const title = href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);

  return `<div class="source-item">
    <strong>${title}</strong>
    <span class="source-meta">${escapeHtml(meta)}</span>
    <p>${escapeHtml(item.excerpt || "")}</p>
  </div>`;
}

function displayArchivePath(report) {
  const filename = (report.wikiPath || report.file || "").split("/").pop() || report.title;
  const category = {
    industry: "产业链研究",
    market: "市场快览",
    stock: "个股跟踪",
    policy: "政策扫描",
    custom: "主题调研"
  }[report.type] || "研究报告";
  return `归档：${category} / ${filename}`;
}

function displayEvidenceSource(source) {
  const value = String(source || "");
  if (value === "vault:reports") return "历史报告";
  if (value.startsWith("local:")) return `本地数据源：${value.slice("local:".length)}`;
  if (value.startsWith("http:")) return `在线数据源：${value.slice("http:".length)}`;
  return value || "未标注来源";
}

function displayConfidence(confidence) {
  return {
    low: "低",
    medium: "中",
    high: "高",
    example: "示例"
  }[confidence] || confidence;
}

function safeEvidenceHref(value) {
  const url = String(value || "").trim();
  if (url.startsWith("/reports/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return "";
}

function buildTitle(topic, type, date) {
  const suffix = {
    industry: "产业链深度",
    market: "市场复盘",
    stock: "个股跟踪",
    policy: "政策日报",
    custom: "主题调研"
  }[type] || "主题调研";

  if (topic.includes(date) || topic.includes(suffix)) return topic;
  return `${topic} - ${suffix}`;
}

function inferType(topic) {
  if (/政策|监管|发改委|工信部|财政/.test(topic)) return "policy";
  if (/A股|美股|市场|指数|成交|风格|复盘/.test(topic)) return "market";
  if (/[（(]?\d{6}[）)]?/.test(topic) || /个股|公司|财报/.test(topic)) return "stock";
  if (/产业|链|材料|算力|半导体|光模块|AI|新能源/.test(topic)) return "industry";
  return "custom";
}

function normalizeType(type) {
  return REPORT_TYPES[type] ? type : "custom";
}

async function seedIfEmpty() {
  const reports = await readReports();
  if (reports.length > 0) return;

  const seeds = [
    {
      topic: "论文速览：AI Agent 与金融研究工作流",
      type: "custom"
    },
    {
      topic: "InP产业链深度：AI光通信光源、衬底与A股映射",
      type: "industry"
    },
    {
      topic: `${localDate()} A股市场复盘：成交缩量与题材轮动`,
      type: "market"
    },
    {
      topic: "云南锗业(002428)：高位冲高回落后的观察点",
      type: "stock"
    },
    {
      topic: "新闻联播政策日报：设备更新、算力与新质生产力",
      type: "policy"
    }
  ];

  for (const seed of seeds) {
    await createReport({ ...seed, source: "seed" });
  }
  await appendLog("seed", "Created starter reports", { count: seeds.length });
}

async function ensureStore() {
  await mkdir(REPORT_DIR, { recursive: true });
  await ensureJsonFile(INDEX_FILE, []);
  await ensureJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
  await ensureJsonFile(LOG_FILE, []);
  await ensureJsonFile(STOCKS_FILE, DEFAULT_STOCKS);
  await ensureJsonFile(POSITIONS_FILE, DEFAULT_POSITIONS);
  await ensureJsonFile(MARKET_INDICES_FILE, DEFAULT_MARKET_INDICES);
  await ensureJsonFile(AUTOMATION_TASKS_FILE, DEFAULT_AUTOMATION_TASKS);
  await ensureJsonFile(DECISIONS_FILE, []);
}

async function ensureJsonFile(file, value) {
  try {
    await access(file);
  } catch {
    await writeJson(file, value);
  }
}

async function migrateReportOrigins() {
  const reports = await readJson(INDEX_FILE, []);
  const normalized = reports.map(normalizeReportRecord);
  if (JSON.stringify(reports) !== JSON.stringify(normalized)) {
    await writeReports(normalized);
  }
}

async function readReports() {
  return sortReports((await readJson(INDEX_FILE, [])).map(normalizeReportRecord));
}

async function writeReports(reports) {
  await writeJson(INDEX_FILE, sortReports(reports.map(normalizeReportRecord)));
}

async function readSettings() {
  return { ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS_FILE, DEFAULT_SETTINGS)) };
}

async function writeSettings(settings) {
  await writeJson(SETTINGS_FILE, { ...DEFAULT_SETTINGS, ...settings });
}

async function findReport(id) {
  const reports = await readReports();
  return reports.find((report) => report.id === id);
}

async function markReportRead(id) {
  const reports = await readReports();
  const index = reports.findIndex((report) => report.id === id);
  if (index === -1) return null;
  reports[index] = {
    ...reports[index],
    status: "read",
    updatedAt: new Date().toISOString()
  };
  await writeReports(reports);
  return reports[index];
}

function sortReports(reports) {
  return [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function normalizeReportRecord(report) {
  const source = String(report.source || "manual");
  const origin = normalizeReportOrigin(report.origin, source);
  return {
    ...report,
    source,
    origin,
    originLabel: originLabel(origin),
    wikiPath: normalizeReportWikiPath(report)
  };
}

function normalizeReportOrigin(value, source = "manual") {
  const origin = String(value || "").trim();
  if (origin === "automation" || origin === "manual") return origin;
  return inferReportOriginFromSource(source);
}

function normalizeReportOriginFilter(value) {
  const origin = String(value || "all").trim();
  return origin === "automation" || origin === "manual" ? origin : "all";
}

function inferReportOriginFromSource(source) {
  const value = String(source || "").trim();
  if (["scheduled", "daily", "automation", "task"].includes(value)) return "automation";
  return "manual";
}

function countReportOrigins(reports) {
  return reports.reduce(
    (counts, report) => {
      const origin = normalizeReportOrigin(report.origin, report.source);
      counts[origin] = (counts[origin] || 0) + 1;
      return counts;
    },
    { automation: 0, manual: 0 }
  );
}

function normalizeReportWikiPath(report) {
  const wikiPath = String(report.wikiPath || "");
  if (report.type === "custom" && wikiPath.startsWith("inbox/research/")) {
    return wikiPath.replace("inbox/research/", "research/themes/");
  }
  return wikiPath;
}

async function appendLog(type, message, meta = {}) {
  const logs = await readJson(LOG_FILE, []);
  logs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    meta,
    createdAt: new Date().toISOString(),
    localTime: localDateTime()
  });
  await writeJson(LOG_FILE, logs.slice(0, 200));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

async function serveFile(res, baseDir, requestedPath) {
  const filePath = safeJoin(baseDir, requestedPath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    if (baseDir === PUBLIC_DIR) {
      await serveFile(res, PUBLIC_DIR, "index.html");
      return;
    }
    const error = new Error("File not found");
    error.statusCode = 404;
    throw error;
  }

  if (!fileStat.isFile()) {
    const error = new Error("File not found");
    error.statusCode = 404;
    throw error;
  }

  const extension = extname(filePath);
  res.writeHead(200, {
    "content-type": MIME_TYPES[extension] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(await readFile(filePath));
}

function safeJoin(baseDir, requestedPath) {
  const base = resolve(baseDir);
  const target = resolve(baseDir, requestedPath || "");
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    const error = new Error("Forbidden path");
    error.statusCode = 403;
    throw error;
  }
  return target;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function buildReportId(date, topic, type) {
  const hash = createHash("sha1").update(`${topic}-${type}-${Date.now()}`).digest("hex").slice(0, 8);
  const slug = slugify(topic).slice(0, 48) || "research";
  return `${date}-${type}-${slug}-${hash}`;
}

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sourceLabel(source) {
  return {
    manual: "手动调研",
    chat: "对话手动入库",
    scheduled: "自动日更",
    seed: "示例种子",
    daily: "日更任务"
  }[source] || source;
}

function originLabel(origin) {
  return REPORT_ORIGINS[origin] || "未标注产出方式";
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.weekday} · ${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
    minute: Number(value.minute)
  };
}

function startOfLocalDayOffset(offsetDays) {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Date(`${localDate(shifted)}T00:00:00+08:00`);
}
