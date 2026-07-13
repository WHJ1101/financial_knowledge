import db from "./db.js";
import { fetchWithTimeout } from "../../lib/http.js";
import { localDate } from "../../lib/datetime.js";

const SECIDS = {
  "000001.SH": "1.000001",
  "399001.SZ": "0.399001",
  "399006.SZ": "0.399006",
  "000688.SH": "1.000688",
  "HSI.HK": "100.HSI",
  "IXIC.US": "100.NDX",
  "SPX.US": "100.SPX"
};

let cache = { data: [], updatedAt: null };
let timer = null;

export function getMarketData() {
  return cache;
}

export async function fetchMarketData() {
  const secids = Object.values(SECIDS).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fields=f1,f2,f3,f4,f6,f12,f14&secids=${secids}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (json.data?.diff) {
      cache.data = json.data.diff.map((item) => ({
        code: item.f12,
        name: item.f14,
        level: item.f2 === "-" ? null : (item.f2 / 100).toFixed(2),
        changePct: item.f3 === "-" ? null : (item.f3 / 100).toFixed(2),
        volume: item.f6 === "-" ? null : item.f6
      }));
      cache.updatedAt = new Date().toISOString();
    }
  } catch (e) {
    console.error("Market data fetch failed:", e.message);
  }
}

function isTradingHours() {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }).format(now));
  const day = now.getDay();
  return day >= 1 && day <= 5 && hour >= 9 && hour <= 15;
}

export function startMarketPoller() {
  fetchMarketData();
  timer = setInterval(() => {
    if (isTradingHours()) fetchMarketData();
  }, 30_000);
}

export function stopMarketPoller() {
  if (timer) clearInterval(timer);
}

export async function searchStocks(keyword) {
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&count=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const json = await res.json();
  const items = json.QuotationCodeTable?.Data || [];
  return items.map(d => ({
    code: d.Code,
    name: d.Name,
    market: classifySecurity(d),
    secid: d.QuoteID
  }));
}

export async function getStockQuote(secid) {
  const normalized = String(secid || "").trim();
  const code = extractSecurityCode(normalized);

  if (isOtcFundSecid(normalized)) {
    const fundQuote = await getFundQuote(code).catch(() => null);
    return fundQuote || getManualQuote(normalized, code);
  }

  const quote = await getExchangeQuote(normalized).catch(() => null);
  if (quote) return quote;

  const fundQuote = code ? await getFundQuote(code).catch(() => null) : null;
  return fundQuote || getManualQuote(normalized, code);
}

async function getExchangeQuote(secid) {
  const [mkt, code] = secid.split(".");
  if (!code) return null;

  let prefix = "";
  if (mkt === "1") prefix = "sh";
  else if (mkt === "0") prefix = "sz";
  else if (mkt === "116") prefix = "hk";
  else if (mkt === "105" || mkt === "106") prefix = "us";
  else return null;

  const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  const parts = text.split("~");
  if (parts.length < 35) return null;
  const price = parseFloat(parts[3]);
  const prevClose = parseFloat(parts[4]);
  if (!price) return null;
  const changePct = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : "0.00";
  return {
    name: parts[1],
    price,
    market: classifyMarketFromSecid(mkt, code),
    high: parseFloat(parts[33]) || price,
    low: parseFloat(parts[34]) || price,
    open: parseFloat(parts[5]) || price,
    changePct,
    source: "exchange",
    sourceLabel: "交易所行情"
  };
}

async function getFundQuote(code) {
  if (!/^\d{6}$/.test(code)) return null;

  const estimated = await getTiantianFundQuote(code).catch(() => null);
  if (estimated) return estimated;

  return getEastmoneyFundQuote(code).catch(() => null);
}

async function getTiantianFundQuote(code) {
  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const text = await res.text();
  return parseTiantianFundJsonp(text);
}

async function getEastmoneyFundQuote(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      referer: "https://fund.eastmoney.com/",
      "user-agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) return null;

  return parseEastmoneyFundPage(await res.text(), code);
}

export function parseTiantianFundJsonp(text) {
  const match = String(text || "").trim().match(/^jsonpgz\(([\s\S]*)\);?$/);
  const payload = match?.[1]?.trim();
  if (!payload || payload === "null" || payload === "undefined") return null;

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  const estimatedNav = toNumber(data.gsz);
  const latestNav = toNumber(data.dwjz);
  const price = estimatedNav || latestNav;
  if (!price) return null;

  const changePct = toNumber(data.gszzl);
  return {
    name: data.name,
    price,
    market: "基金",
    high: price,
    low: price,
    open: latestNav || price,
    changePct: Number.isFinite(changePct) ? changePct.toFixed(2) : "0.00",
    source: estimatedNav ? "fund-estimate" : "fund-nav",
    sourceLabel: estimatedNav ? "基金估算净值" : "基金最新净值",
    nav: latestNav || null,
    navDate: data.jzrq || "",
    updatedAt: data.gztime || data.jzrq || ""
  };
}

export function parseEastmoneyFundPage(text, code = "") {
  const name = readJsStringVar(text, "fS_name") || code;
  const trend = readJsArrayVar(text, "Data_netWorthTrend");
  const latest = Array.isArray(trend) ? trend.at(-1) : null;
  const price = toNumber(latest?.y);
  if (!price) return null;

  const changePct = toNumber(latest?.equityReturn);
  const navDate = formatTimestampDate(latest?.x);
  return {
    name,
    price,
    market: "基金",
    high: price,
    low: price,
    open: price,
    changePct: Number.isFinite(changePct) ? changePct.toFixed(2) : "0.00",
    source: "fund-nav",
    sourceLabel: "东方财富基金净值",
    nav: price,
    navDate,
    updatedAt: navDate
  };
}

function getManualQuote(secid, code) {
  const keys = Array.from(new Set([String(secid || "").trim(), String(code || "").trim()].filter(Boolean)));
  for (const key of keys) {
    const row = db.prepare("SELECT * FROM quote_overrides WHERE code=?").get(key);
    if (row) return formatManualQuote(row);
  }
  return null;
}

function formatManualQuote(row) {
  const price = Number(row.price);
  return {
    name: row.name || row.code,
    price,
    market: row.market || "手动",
    high: price,
    low: price,
    open: price,
    changePct: row.change_pct || "0.00",
    source: "manual",
    sourceLabel: row.source_label || "手动行情",
    note: row.note || "",
    updatedAt: row.updated_at
  };
}

function classifySecurity(item) {
  const classify = String(item.Classify || "");
  const securityType = String(item.SecurityType || "");
  const securityTypeName = String(item.SecurityTypeName || "");
  const jys = String(item.JYS || "");
  const mktNum = String(item.MktNum || "");

  if (classify === "AStock") return "A股";
  if (classify === "HKStock") return "港股";
  if (classify === "USStock" || classify === "UsStock") return "美股";
  if (jys === "OTCFUND" || classify === "OTCFUND" || mktNum === "150" || securityType === "17") return "基金";
  if (classify === "Fund" || securityTypeName.includes("基金")) return isExchangeFundCode(item.Code) ? "ETF" : "基金";
  return "美股";
}

function classifyMarketFromSecid(mkt, code) {
  if (isExchangeFundCode(code)) return "ETF";
  if (mkt === "116") return "港股";
  if (mkt === "105" || mkt === "106") return "美股";
  return "A股";
}

function isOtcFundSecid(secid) {
  return secid.split(".")[0] === "150";
}

function extractSecurityCode(value) {
  const match = String(value || "").match(/\b\d{6}\b/);
  return match ? match[0] : "";
}

function isExchangeFundCode(code) {
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(String(code || ""));
}

function readJsStringVar(text, name) {
  const match = String(text || "").match(new RegExp(`var\\s+${name}\\s*=\\s*["']([^"']*)["']\\s*;`));
  return match?.[1] || "";
}

function readJsArrayVar(text, name) {
  const match = String(text || "").match(new RegExp(`var\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;`));
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function formatTimestampDate(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// —— 场外基金历史净值抓取（.doc/持仓市值走势曲线设计与验收清单 §4.1）——

const FUND_HTTP_TIMEOUT_MS = Number(process.env.FUND_NAV_TIMEOUT_MS || 8000);
const FUND_MAX_ATTEMPTS = Number(process.env.FUND_NAV_MAX_ATTEMPTS || 3);
const FUND_RETRY_MS = Number(process.env.FUND_NAV_RETRY_MS || 600);

// 抓取场外基金完整历史「前复权净值」序列 [{date, close}]（close 见 parseFundNavHistory 口径）。
// 复用 pingzhongdata 接口。无效 code 返回 []；HTTP/网络错误向调用方抛出，供采集层记录失败。
export async function fetchFundNavHistory(code, { fetchImpl = globalThis.fetch } = {}) {
  if (!/^\d{6}$/.test(String(code || ""))) return [];
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
  const text = await fetchTextWithRetry(url, { fetchImpl, timeout: FUND_HTTP_TIMEOUT_MS });
  return parseFundNavHistory(text);
}

// 从 pingzhongdata 文本解析「前复权净值」序列。
// close = 最新单位净值 × 累计净值(t) / 最新累计净值（§1.3 口径③）：
//   历史涨跌率取自累计净值（消除分红除息假暴跌），末点=最新单位净值（与成本/概览口径一致，不虚高）。
// 无 Data_ACWorthTrend（个别老基金）时降级为单位净值（factor=1），并给每点标 navKind:"unit"。
export function parseFundNavHistory(text) {
  const acRaw = readJsArrayVar(text, "Data_ACWorthTrend");   // [[x, y], ...] 累计净值
  const unitRaw = readJsArrayVar(text, "Data_netWorthTrend"); // [{x,y,equityReturn}] 单位净值

  const latestUnit = Array.isArray(unitRaw) && unitRaw.length ? toNumber(unitRaw.at(-1)?.y) : null;

  // 优先用累计净值序列；缺失时降级用单位净值序列。
  if (Array.isArray(acRaw) && acRaw.length) {
    const acPoints = normalizeNavPoints(acRaw.map((row) => ({ x: row?.[0], y: row?.[1] })));
    if (!acPoints.length) return [];
    const latestAc = acPoints.at(-1).close;
    // factor 把累计净值缩放到「以最新单位净值为锚」：末点 close == latestUnit。
    const factor = latestUnit && latestAc ? latestUnit / latestAc : 1;
    return acPoints.map((p) => ({ date: p.date, close: round4(p.close * factor) }));
  }

  if (Array.isArray(unitRaw) && unitRaw.length) {
    const unitPoints = normalizeNavPoints(unitRaw.map((row) => ({ x: row?.x, y: row?.y })));
    return unitPoints.map((p) => ({ date: p.date, close: p.close, navKind: "unit" }));
  }

  return [];
}

// 把 [{x:ms, y:nav}] 清洗为 [{date:YYYY-MM-DD(北京时间), close>0}]，升序、同日去重（保留后者）。
function normalizeNavPoints(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const ts = Number(row?.x);
    const nav = toNumber(row?.y);
    if (!Number.isFinite(ts) || nav == null || nav <= 0) continue;
    const date = localDate(new Date(ts)); // Asia/Shanghai
    byDate.set(date, nav);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

// 带重试的文本抓取：数据源偶发 socket 关闭/超时，重试后再失败才抛给调用方。非 2xx 抛错。
async function fetchTextWithRetry(url, { fetchImpl = globalThis.fetch, timeout = FUND_HTTP_TIMEOUT_MS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= FUND_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        fetchImpl,
        timeout,
        headers: { referer: "https://fund.eastmoney.com/", "user-agent": "Mozilla/5.0" },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < FUND_MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, FUND_RETRY_MS * attempt));
    }
  }
  throw lastErr;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
