// 日线数据抓取与落库。板块压力监控（.doc/板块压力监控模块设计与验收清单.md §3.2）依赖
// 每个代理标的约 250 个交易日的收盘价 + 成交量，落 daily_bars 表（复合主键天然幂等）。
// secid 前缀分派两个数据源：东财（A股/美股 ETF）与 Yahoo（VIX/VIX3M 期限结构）。
import db from "./db.js";
import { fetchWithTimeout } from "../../lib/http.js";

const HTTP_TIMEOUT_MS = Number(process.env.PRESSURE_KLINE_TIMEOUT_MS || 8000);
const DEFAULT_LIMIT = 250;
// 数据源（尤其东财美股标的）偶发 socket 关闭 / 超时，重试几次显著提高日更成功率。
// 重试次数与退避可经 env 调低，便于测试快速走完失败路径。
const MAX_ATTEMPTS = Number(process.env.PRESSURE_KLINE_MAX_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.PRESSURE_KLINE_RETRY_MS || 600);
// 东财美股标的无 UA 偶发空响应，统一带上。
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Yahoo 系标的用 YAHOO. 前缀，其余按东财 secid（如 1.512480 / 105.SOXX）处理。
const YAHOO_PREFIX = "YAHOO.";
const YAHOO_SYMBOLS = { "YAHOO.VIX": "^VIX", "YAHOO.VIX3M": "^VIX3M" };

// 抓取单个标的最近日线并 UPSERT 落库。返回写入条数；失败返回 0 并记录 error（不抛，供批量容错）。
export async function fetchDailyBars(secid, { fetchImpl = globalThis.fetch, limit = DEFAULT_LIMIT } = {}) {
  return secid.startsWith(YAHOO_PREFIX)
    ? fetchYahooKline(secid, { fetchImpl, limit })
    : fetchEastmoneyKline(secid, { fetchImpl, limit });
}

// 东财日线：fields2=f51,f53,f56 即 date,close,volume（实测字段序）。data=null 表示 secid 无效。
export async function fetchEastmoneyKline(secid, { fetchImpl = globalThis.fetch, limit = DEFAULT_LIMIT } = {}) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=101&fqt=1&fields1=f1,f2&fields2=f51,f53,f56&beg=0&end=20500101&lmt=${limit}`;
  const json = await fetchJsonWithRetry(url, { fetchImpl });
  const klines = json?.data?.klines;
  if (!Array.isArray(klines)) return [];
  const bars = [];
  for (const line of klines) {
    const [date, close, volume] = String(line).split(",");
    const closeNum = Number(close);
    const volumeNum = Number(volume);
    if (!date || !Number.isFinite(closeNum)) continue;
    bars.push({ date, close: closeNum, volume: Number.isFinite(volumeNum) ? volumeNum : null });
  }
  return bars;
}

// Yahoo chart：取 timestamp + indicators.quote[0].close，过滤 null 收盘点。VIX 无成交量，volume 记 null。
export async function fetchYahooKline(secid, { fetchImpl = globalThis.fetch, limit = DEFAULT_LIMIT } = {}) {
  const symbol = YAHOO_SYMBOLS[secid] || secid.slice(YAHOO_PREFIX.length);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const json = await fetchJsonWithRetry(url, { fetchImpl });
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(Number(close))) continue;
    const date = new Date(Number(timestamps[i]) * 1000).toISOString().slice(0, 10);
    bars.push({ date, close: Number(close), volume: null });
  }
  return bars.slice(-limit);
}

// 带重试的 JSON 抓取：数据源偶发 socket 关闭 / 超时，重试后再失败才抛给调用方。
async function fetchJsonWithRetry(url, { fetchImpl }) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { fetchImpl, timeout: HTTP_TIMEOUT_MS, headers: { "user-agent": USER_AGENT } });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 拉取一组 secid 的日线并落库。单个 secid 失败不影响其余（各自 try/catch）。
export async function syncDailyBars(secids = [], { fetchImpl = globalThis.fetch } = {}) {
  const now = new Date().toISOString();
  const results = [];
  for (const secid of secids) {
    try {
      const bars = await fetchDailyBars(secid, { fetchImpl });
      const written = upsertBars(secid, bars, now);
      results.push({ secid, ok: true, count: written });
    } catch (err) {
      results.push({ secid, ok: false, count: 0, error: err.message });
    }
  }
  return results;
}

function upsertBars(secid, bars, now) {
  if (!bars.length) return 0;
  const stmt = db.prepare("INSERT OR REPLACE INTO daily_bars (secid,date,close,volume,updated_at) VALUES (?,?,?,?,?)");
  const tx = db.transaction((rows) => {
    for (const bar of rows) stmt.run(secid, bar.date, bar.close, bar.volume, now);
  });
  tx(bars);
  return bars.length;
}

// 读取某 secid 最近 limit 条日线，按日期升序返回（计算层需要时序）。
export function getBars(secid, limit = DEFAULT_LIMIT) {
  const rows = db.prepare("SELECT date, close, volume FROM daily_bars WHERE secid=? ORDER BY date DESC LIMIT ?").all(secid, limit);
  return rows.reverse().map((row) => ({ date: row.date, close: row.close, volume: row.volume }));
}
