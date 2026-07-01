const TIME_ZONE = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = Number(process.env.DAILY_BRIEFING_TIMEOUT_MS || 8000);
const MIN_NEWS_CANDIDATES = Number(process.env.DAILY_BRIEFING_MIN_NEWS_CANDIDATES || 30);
const MAX_NEWS_CANDIDATES = Number(process.env.DAILY_BRIEFING_MAX_NEWS_CANDIDATES || 50);
const DISPLAY_NEWS_ITEMS = 20;

const INDEX_SECIDS = {
  "000001.SH": "1.000001",
  "399001.SZ": "0.399001",
  "399006.SZ": "0.399006",
  "000688.SH": "1.000688",
  "HSI.HK": "100.HSI",
  "IXIC.US": "100.NDX",
  "SPX.US": "100.SPX"
};

export async function runDailyMarketBriefingPipeline({
  now = new Date(),
  positions = [],
  fetchImpl = globalThis.fetch,
  quoteFetcher = null,
  newsProviders = defaultNewsProviders(),
  marketData = null,
  communitySignals = [],
  signalSync = null
} = {}) {
  const window = buildNewsWindow(now);
  const dateKey = formatLocalDate(now).replaceAll("-", "");

  const [indices, positionQuotes, news] = await Promise.all([
    marketData ? Promise.resolve({ ok: true, rows: marketData, source: "注入行情" }) : collectMarketIndices({ fetchImpl, dateKey }),
    collectPositionQuotes({ positions, quoteFetcher }),
    collectNewsCandidates({ windowStart: window.start, windowEnd: window.end, fetchImpl, providers: newsProviders })
  ]);

  const evidence = [
    evidenceItem("大盘指数", indices, formatIndexRows((indices.rows || []).filter((row) => !isGlobalIndex(row)))),
    evidenceItem("全球市场", indices, formatIndexRows((indices.rows || []).filter(isGlobalIndex))),
    evidenceItem("持仓行情", positionQuotes, formatPositionRows(positionQuotes.rows || [])),
    communitySignalsEvidenceItem(communitySignals, window, signalSync),
    newsEvidenceItem(news, window),
    newsQualityEvidenceItem(news, window)
  ].filter((item) => item.excerpt);

  return {
    summary: buildSummary({ news, indices, positionQuotes, communitySignals, window }),
    highlights: buildHighlights({ news, indices, positionQuotes, communitySignals }),
    watchList: buildWatchList({ news, positionQuotes, communitySignals }),
    risks: buildRisks({ news, communitySignals }),
    nextSteps: buildNextSteps({ news, communitySignals }),
    tags: ["每日简报", "市场", "新闻", "知识库", ...(communitySignals.length ? ["社群信号"] : [])],
    evidence,
    dataQuality: buildDataQuality({ news, indices, positionQuotes, communitySignals, signalSync, window }),
    window
  };
}

export function buildNewsWindow(now = new Date()) {
  const end = new Date(now);
  return {
    start: new Date(end.getTime() - DAY_MS),
    end,
    timezone: TIME_ZONE
  };
}

export async function collectNewsCandidates({ windowStart, windowEnd, fetchImpl = globalThis.fetch, providers = defaultNewsProviders() }) {
  const activeProviders = providers.filter(Boolean);
  if (!activeProviders.length) {
    return {
      items: [],
      displayed: [],
      sourceStats: [{ provider: "news-provider", ok: false, count: 0, error: "未配置新闻源" }],
      windowStart,
      windowEnd
    };
  }

  const results = await Promise.all(activeProviders.map((provider) => runNewsProvider(provider, { windowStart, windowEnd, fetchImpl })));
  const sourceStats = results.map(({ provider, ok, items, error }) => ({
    provider,
    ok,
    count: items.length,
    error: error || ""
  }));
  const items = rankNewsCandidates(dedupeNewsItems(results.flatMap((result) => result.items))
    .filter((item) => isWithinWindow(item.publishedAt, windowStart, windowEnd)))
    .slice(0, MAX_NEWS_CANDIDATES);

  return {
    items,
    displayed: items.slice(0, DISPLAY_NEWS_ITEMS),
    sourceStats,
    windowStart,
    windowEnd
  };
}

export function rankNewsCandidates(items) {
  return items
    .map((item, index) => ({
      ...item,
      importanceScore: scoreNewsItem(item) - index * 0.01
    }))
    .sort((a, b) => b.importanceScore - a.importanceScore || Number(new Date(b.publishedAt)) - Number(new Date(a.publishedAt)));
}

function defaultNewsProviders() {
  const providers = [];
  if (process.env.DAILY_BRIEFING_NEWS_URL) {
    providers.push({ name: "json-url", fetch: fetchJsonNewsProvider(process.env.DAILY_BRIEFING_NEWS_URL) });
  }
  if (process.env.DAILY_BRIEFING_EASTMONEY_DISABLED !== "1") {
    providers.push({ name: "eastmoney", fetch: fetchEastmoneyNews });
  }
  if (process.env.DAILY_BRIEFING_GDELT_DISABLED !== "1") {
    providers.push({ name: "gdelt", fetch: fetchGdeltNews });
  }
  if (process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY) {
    providers.push({ name: "alpha-vantage", fetch: fetchAlphaVantageNews });
  }
  return providers;
}

async function runNewsProvider(provider, context) {
  try {
    const rawItems = await provider.fetch(context);
    return {
      provider: provider.name,
      ok: true,
      items: normalizeNewsItems(rawItems, provider.name)
    };
  } catch (error) {
    return {
      provider: provider.name,
      ok: false,
      items: [],
      error: String(error.message || error).slice(0, 180)
    };
  }
}

function fetchJsonNewsProvider(url) {
  return async ({ fetchImpl }) => {
    const json = await fetchJson(url, { fetchImpl });
    return expandRecords(json);
  };
}

async function fetchEastmoneyNews({ windowStart, fetchImpl }) {
  const pageSize = Number(process.env.DAILY_BRIEFING_EASTMONEY_PAGE_SIZE || 100);
  const maxPages = Number(process.env.DAILY_BRIEFING_EASTMONEY_MAX_PAGES || 12);
  const items = [];
  const seenSortEnd = new Set();
  let sortEnd = "";

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL("https://np-listapi.eastmoney.com/comm/web/getFastNewsList");
    url.searchParams.set("client", "web");
    url.searchParams.set("biz", "web_724");
    url.searchParams.set("fastColumn", "102");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("sortEnd", sortEnd);
    url.searchParams.set("req_trace", `${Date.now()}-${page}`);

    const json = await fetchJson(String(url), { fetchImpl });
    const pageItems = expandRecords(json?.data?.fastNewsList || json?.data?.items || json?.data || json);
    items.push(...pageItems);

    const nextSortEnd = String(json?.data?.sortEnd || "");
    const oldest = pageItems
      .map((item) => normalizeDate(item.showTime || item.publishTime || item.time))
      .filter(Boolean)
      .sort()[0];
    if (!nextSortEnd || seenSortEnd.has(nextSortEnd) || !pageItems.length) break;
    if (oldest && new Date(oldest).getTime() < windowStart.getTime()) break;
    seenSortEnd.add(nextSortEnd);
    sortEnd = nextSortEnd;
  }

  return items;
}

async function fetchGdeltNews({ windowStart, windowEnd, fetchImpl }) {
  const query = process.env.DAILY_BRIEFING_GDELT_QUERY || "(market OR economy OR stock OR China OR semiconductor OR AI OR policy)";
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(process.env.DAILY_BRIEFING_GDELT_MAX_RECORDS || 100));
  url.searchParams.set("sort", "HybridRel");
  url.searchParams.set("startdatetime", gdeltDate(windowStart));
  url.searchParams.set("enddatetime", gdeltDate(windowEnd));
  const json = await fetchJson(String(url), { fetchImpl });
  return expandRecords(json?.articles || json);
}

async function fetchAlphaVantageNews({ windowStart, windowEnd, fetchImpl }) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) return [];
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("time_from", alphaDate(windowStart));
  url.searchParams.set("time_to", alphaDate(windowEnd));
  url.searchParams.set("sort", "RELEVANCE");
  url.searchParams.set("limit", String(process.env.DAILY_BRIEFING_ALPHA_LIMIT || 200));
  if (process.env.DAILY_BRIEFING_ALPHA_TOPICS) url.searchParams.set("topics", process.env.DAILY_BRIEFING_ALPHA_TOPICS);
  const json = await fetchJson(String(url), { fetchImpl });
  return expandRecords(json?.feed || json);
}

async function collectMarketIndices({ fetchImpl, dateKey }) {
  const secids = Object.values(INDEX_SECIDS).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f6,f12,f13,f14&secids=${secids}`;
  try {
    const json = await fetchJson(url, { fetchImpl });
    const rows = (json.data?.diff || []).map((item) => ({
      "指数代码": codeFromEastmoney(item.f12, item.f13),
      "指数简称": item.f14,
      [`涨跌幅[${dateKey}]`]: toPercentNumber(item.f3),
      [`成交额[${dateKey}]`]: item.f6 === "-" ? "" : Number(item.f6)
    }));
    return { ok: true, rows, source: "东方财富行情" };
  } catch (error) {
    return { ok: false, rows: [], source: "东方财富行情", error: String(error.message || error).slice(0, 180) };
  }
}

async function collectPositionQuotes({ positions = [], quoteFetcher = null }) {
  if (!positions.length) return { ok: true, rows: [], source: "持仓", note: "暂无持仓" };
  if (!quoteFetcher) {
    return {
      ok: false,
      rows: positions.map((position) => ({
        "证券代码": position.code,
        "证券简称": position.name,
        "市场": position.market || "",
        "持仓数量": position.shares || 0,
        "成本": position.cost || 0
      })),
      source: "持仓",
      error: "未配置持仓行情查询"
    };
  }

  const rows = [];
  for (const position of positions.slice(0, 20)) {
    const quoteKey = position.quoteSecid || position.quote_secid || position.code;
    const quote = await quoteFetcher(quoteKey).catch(() => null);
    rows.push({
      "证券代码": position.code,
      "证券简称": position.name || quote?.name || "",
      "市场": position.market || quote?.market || "",
      "现价": quote?.price || "",
      "涨跌幅": quote?.changePct || "",
      "持仓数量": position.shares || 0,
      "成本": position.cost || 0
    });
  }
  return { ok: true, rows, source: "持仓行情" };
}

function normalizeNewsItems(records, provider) {
  return expandRecords(records)
    .map((record, index) => {
      const title = firstText(record.title, record.name, record.headline, record.Title, record.titleShow);
      if (!title) return null;
      const publishedAt = normalizeDate(firstText(record.publishedAt, record.publishTime, record.showTime, record.datetime, record.seendate, record.time, record.createdAt, record.NewsTime));
      return {
        id: firstText(record.id, record.code, record.url, record.link) || `${provider}-${index}`,
        title,
        summary: firstText(record.summary, record.description, record.content, record.digest, record.seendesc),
        source: firstText(record.source, record.sourceName, record.sourcecountry, record.domain, record.infoSource) || provider,
        provider,
        url: firstText(record.url, record.link, record.shareurl),
        publishedAt,
        language: firstText(record.language, record.lang),
        region: firstText(record.region, record.country, record.sourcecountry),
        hotScore: toFiniteNumber(record.hotScore ?? record.hot ?? record.weight ?? record.share ?? record.pinglun_Num ?? record.relevance_score),
        relevanceScore: toFiniteNumber(record.relevanceScore ?? record.relevance_score ?? record.overall_sentiment_score)
      };
    })
    .filter((item) => item?.publishedAt);
}

function scoreNewsItem(item) {
  const text = `${item.title} ${item.summary || ""}`;
  let score = 0;
  for (const rule of NEWS_IMPORTANCE_RULES) {
    if (rule.pattern.test(text)) score += rule.score;
  }
  score += Number(item.hotScore || 0) * 0.1;
  score += Number(item.relevanceScore || 0) * 10;
  if (/gdelt|alpha-vantage|json-url|eastmoney/.test(item.provider)) score += 2;
  return score;
}

const NEWS_IMPORTANCE_RULES = [
  { score: 36, pattern: /央行|人民银行|降准|降息|逆回购|MLF|LPR|liquidity|central bank|Fed|Federal Reserve|rate cut|rate hike/i },
  { score: 30, pattern: /证监会|交易所|监管|IPO|减持|回购|并购|重组|退市|regulator|SEC|policy|tariff|sanction/i },
  { score: 28, pattern: /AI|人工智能|算力|芯片|半导体|英伟达|NVIDIA|华为|Ascend|HBM|数据中心|semiconductor|datacenter/i },
  { score: 24, pattern: /A股|港股|美股|创业板|科创|沪深|纳指|标普|恒生|ETF|北向|南向|stock|market|Nasdaq|S&P/i },
  { score: 20, pattern: /财报|业绩|订单|目标价|评级|召回|专利|earnings|guidance|upgrade|downgrade|recall/i },
  { score: -8, pattern: /人事变动|取得\d*项发明专利证书|日内涨幅|抹去日内/i }
];

function dedupeNewsItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeKey(item.url || item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function newsEvidenceItem(news, window) {
  const shortage = news.items.length < MIN_NEWS_CANDIDATES;
  const displayed = news.displayed || [];
  return {
    title: `今日财经快讯 (${displayed.length}条${shortage ? "，候选池不足" : ""})`,
    source: `多源快讯 · 候选池 ${news.items.length} 条 · ${formatWindow(window)}`,
    observedAt: window.end.toISOString(),
    confidence: shortage ? "low" : "medium",
    excerpt: displayed.map((item) => `[${formatLocalDateTime(new Date(item.publishedAt))}] ${item.title}`).join("\n") || "未采集到新闻候选。"
  };
}

function newsQualityEvidenceItem(news, window) {
  const rows = [
    `指标: 采集窗口 | 数值: ${formatWindow(window)} | 状态: 固定24小时`,
    `指标: 候选池 | 数值: ${news.items.length}条 | 状态: ${news.items.length < MIN_NEWS_CANDIDATES ? "不足" : "正常"}`,
    ...news.sourceStats.map((stat) => `指标: ${stat.provider} | 数值: ${stat.count}条 | 状态: ${stat.ok ? "正常" : `失败: ${stat.error || "无数据"}`}`)
  ];
  return {
    title: "新闻候选池质量",
    source: "系统采集",
    observedAt: window.end.toISOString(),
    confidence: news.items.length < MIN_NEWS_CANDIDATES ? "low" : "medium",
    excerpt: rows.join("\n")
  };
}

function communitySignalsEvidenceItem(signals = [], window, signalSync) {
  const rows = signals.slice(0, 8).map((signal) => [
    `主题: ${signal.theme || "未分类"}`,
    `类型: ${signal.signalType || "线索"}`,
    `相关资产: ${(signal.relatedAssets || []).join("、") || "待识别"}`,
    `重要性: ${signal.importance || 1}/5`,
    `状态: ${signal.verificationStatus || "待验证"}`,
    `摘要: ${signal.summary || ""}`
  ].join(" | "));

  const source = signalSync?.source?.title
    ? `飞书知识源 · ${signalSync.source.title} · ${formatWindow(window)}`
    : `社群信号池 · ${formatWindow(window)}`;

  const fallback = signalSync?.skipped
    ? `未同步：${signalSync.reason || "未配置飞书社群信号源"}`
    : signalSync?.ok === false
      ? `同步失败：${signalSync.reason || signalSync.extractionError || "未知错误"}`
      : "";

  return {
    title: `社群信号 (${signals.length}条)`,
    source,
    observedAt: window.end.toISOString(),
    confidence: signals.length ? "medium" : "low",
    excerpt: rows.join("\n") || fallback
  };
}

function evidenceItem(title, result, excerpt) {
  return {
    title,
    source: result.source || "系统采集",
    observedAt: new Date().toISOString(),
    confidence: result.ok ? "medium" : "low",
    excerpt: excerpt || (result.error ? `采集失败：${result.error}` : "")
  };
}

function formatIndexRows(rows) {
  return rows.map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(" | ")).join("\n");
}

function formatPositionRows(rows) {
  return rows.map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(" | ")).join("\n");
}

function buildSummary({ news, communitySignals, window }) {
  const quality = news.items.length < MIN_NEWS_CANDIDATES ? "候选池仍不足，需要继续补源。" : "新闻候选池已形成。";
  const signalText = communitySignals.length ? `社群信号已入库 ${communitySignals.length} 条。` : "";
  return `过去24小时市场简报已采集至 ${formatLocalDateTime(window.end)}，${quality}${signalText}`;
}

function buildHighlights({ news, indices, positionQuotes, communitySignals }) {
  const items = [];
  if (indices.rows?.length) items.push(`指数层已采集 ${indices.rows.length} 个核心市场指标。`);
  if (positionQuotes.rows?.length) items.push(`持仓层已跟踪 ${positionQuotes.rows.length} 个标的行情。`);
  if (communitySignals.length) items.push(`社群信号层从私有飞书知识源提取 ${communitySignals.length} 条待验证线索，优先展示重要性最高的主题。`);
  if (news.items.length) items.push(`新闻层从 ${news.sourceStats.length} 个来源汇总 ${news.items.length} 条候选，默认展示重要性排序前 ${Math.min(DISPLAY_NEWS_ITEMS, news.items.length)} 条。`);
  if (news.items[0]) items.push(`当前最高优先级快讯：${news.items[0].title}`);
  return items.length ? items.slice(0, 6) : ["日报已生成，但数据源候选不足。"];
}

function buildWatchList({ news, positionQuotes, communitySignals }) {
  const themes = news.items.slice(0, 5).map((item) => item.title).filter(Boolean);
  const signalThemes = communitySignals.slice(0, 3).map((item) => `${item.theme || "社群线索"}：${item.summary}`).filter(Boolean);
  return [
    signalThemes.length ? `核验高优先级社群信号：${signalThemes.join("；")}` : "同步并结构化高质量社群信号，补充一线反馈。",
    themes.length ? `继续核验高优先级新闻：${themes.join("；")}` : "补齐中文与国际快讯候选池。",
    positionQuotes.rows?.length ? "结合持仓标的复核隔夜新闻、公告与盘前价格变化。" : "补充持仓或自选标的，以便日报给出组合相关跟踪。"
  ];
}

function buildRisks({ news, communitySignals }) {
  const risks = [];
  if (news.items.length < MIN_NEWS_CANDIDATES) risks.push(`新闻候选池仅 ${news.items.length} 条，不足以代表过去24小时全量重要事件。`);
  if (news.sourceStats.some((stat) => !stat.ok)) risks.push("部分新闻源采集失败，重要性排序可能偏向可用来源。");
  if (communitySignals.length) risks.push("社群信号来自私域一线反馈，默认是待验证线索，必须用公告、新闻、行情或产业数据交叉核验。");
  return risks.length ? risks : ["新闻排序由规则和来源信号共同驱动，仍需人工复核关键结论。"];
}

function buildNextSteps({ news, communitySignals }) {
  return [
    communitySignals.length ? "把高优先级社群信号逐条标记为已验证、待验证或已证伪，并沉淀核验依据。" : "接入飞书社群信号源，形成日报前的私域线索候选池。",
    "把日报快讯源逐步扩展为东方财富、GDELT、Alpha Vantage/NewsAPI 与后续授权源的组合。",
    news.items.length < MIN_NEWS_CANDIDATES ? "优先修复候选池数量不足问题，再让 LLM 总结 Top 5 影响。" : "在候选 Top 50 基础上加入 LLM 影响归因。"
  ];
}

function buildDataQuality({ news, indices, positionQuotes, communitySignals, signalSync, window }) {
  return [
    { name: "采集窗口", status: `${formatWindow(window)} · 固定24小时` },
    { name: "指数行情", status: indices.ok ? `正常 · ${indices.rows.length} 条` : `失败 · ${indices.error}` },
    { name: "持仓行情", status: positionQuotes.ok ? `正常 · ${positionQuotes.rows.length} 条` : `降级 · ${positionQuotes.error}` },
    { name: "社群信号", status: communitySignals.length ? `正常 · ${communitySignals.length} 条 · ${signalSync?.extractionMethod || "信号池"}` : (signalSync?.skipped ? "未配置" : signalSync?.ok === false ? `失败 · ${signalSync.reason || signalSync.extractionError}` : "暂无") },
    { name: "新闻候选池", status: news.items.length < MIN_NEWS_CANDIDATES ? `不足 · ${news.items.length} 条` : `正常 · ${news.items.length} 条` },
    { name: "新闻源", status: news.sourceStats.map((stat) => `${stat.provider}:${stat.ok ? stat.count : "失败"}`).join(" · ") || "未配置" }
  ];
}

async function fetchJson(url, { fetchImpl }) {
  if (!fetchImpl) throw new Error("fetch is unavailable");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function expandRecords(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.records)) return data.records;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.list)) return data.list;
  return [data];
}

function isWithinWindow(value, start, end) {
  const time = Number(new Date(value));
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{14}$/.test(text)) {
    return new Date(Date.UTC(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      Number(text.slice(8, 10)),
      Number(text.slice(10, 12)),
      Number(text.slice(12, 14))
    )).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return new Date(`${text.replace(" ", "T")}+08:00`).toISOString();
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toPercentNumber(value) {
  if (value === "-") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 100 : "";
}

function codeFromEastmoney(code, market) {
  if (market === 1) return `${code}.SH`;
  if (market === 0) return `${code}.SZ`;
  return code;
}

function isGlobalIndex(row) {
  return /HSI|IXIC|SPX|恒生|纳指|标普/i.test(`${row["指数代码"]} ${row["指数简称"]}`);
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "").slice(0, 220);
}

function gdeltDate(date) {
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function alphaDate(date) {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 13);
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatLocalDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}

function formatWindow(window) {
  return `${formatLocalDateTime(window.start)} 至 ${formatLocalDateTime(window.end)}`;
}
