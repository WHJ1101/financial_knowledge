// 持仓历史采集编排 + secid 归一化（.doc/持仓市值走势曲线设计与验收清单 §三 / §4.3）。
// - resolveBarSecid：把持仓归一化为 daily_bars 主键（基金分支最先短路；先查 secid_map 持久化归类）。
// - syncPortfolioBars：按 secid 去重回补；交易所判定但取不到数时回退试基金接口（market 字段实测不可信）。
// - secid_map：持久化"code→已确定 secid"，让采集层探测结果对查询层可见，两层恒一致。
import db from "./db.js";
import { getPositions } from "../routes/stocks.js";
import { fetchHistoricalExchangeBars, upsertBars } from "./kline-store.js";
import { fetchFundNavHistory } from "./market-data.js";

const fundResult = (code) => ({ secid: `OF.${code}`, kind: "fund", fetchCode: code, currency: "CNY" });
const exchangeResult = (secid) => ({ secid, kind: "exchange", fetchCode: secid, currency: "CNY" });

// 交易所支持市场集合（不含「基金」——基金已被约束 0 提前短路到 OF. 分支）。
const SUPPORTED_MARKETS = ["A股", "ETF", "深市主板", "沪市主板", "科创板", "创业板"];

// 从 "150.014662" / "1.588170" 抠出 6 位 code。
function extractCode(value) {
  const m = String(value || "").match(/\b\d{6}\b/);
  return m ? m[0] : "";
}

// market + code → 东财交易所 secid。只对已排除基金分支的交易所证券调用。
// 深市：0/15/16/18/3 开头 → 0.；沪市：5/6 开头 → 1.（.doc §三约束 4）。
export function exchangeSecidFromCode(code, market = "") {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return null;
  if (/^(0|15|16|18|3)/.test(c)) return `0.${c}`;
  if (/^(5|6)/.test(c)) return `1.${c}`;
  return null;
}

// 纯规则归类（不查库、不联网）：按 quote_secid / market / code 号段给出首选归类。
// 约束 0：基金分支最先判、短路——避免 LOF 同码（如 163806）被误判成场内证券。
export function classifyBarSecid(position = {}) {
  const code = String(position.code || "").trim();
  const secid = String(position.quoteSecid || position.quote_secid || "").trim();
  const market = String(position.market || "").trim();

  // ① 场外基金最先判、短路
  if (secid.startsWith("150.")) {
    const c = extractCode(secid) || code;
    if (/^\d{6}$/.test(c)) return fundResult(c);
  }
  if (market.includes("基金") && /^\d{6}$/.test(code)) return fundResult(code);

  // ② 港股 / 美股 / 其它不支持市场 → skip
  if (/港|美|hk|us/i.test(market)) return null;
  if (/^(100|105|106|107|116|155|156)\./.test(secid)) return null;

  // ③ 已有交易所 secid
  if (/^(0|1)\.\d{6}$/.test(secid)) return exchangeResult(secid);

  // ④ 空 secid 的 A 股 / ETF：按 market + code 号段补前缀
  if (!secid && /^\d{6}$/.test(code) && SUPPORTED_MARKETS.some((m) => market.includes(m))) {
    const ex = exchangeSecidFromCode(code, market);
    if (ex) return exchangeResult(ex);
  }
  return null;
}

// 读一条 secid_map 归类记录。
export function getMappedSecid(code) {
  return db.prepare("SELECT code, secid, kind FROM secid_map WHERE code=?").get(String(code || ""));
}

// 写/更新一条 secid_map 归类记录（幂等）。
export function saveSecidMap(code, secid, kind, now = new Date().toISOString()) {
  db.prepare("INSERT OR REPLACE INTO secid_map (code,secid,kind,resolved_at) VALUES (?,?,?,?)")
    .run(String(code), secid, kind, now);
}

// 归一化产出统一契约（.doc §三）。先查 secid_map 持久化归类，命中即用（查询层零探测）；
// 未命中走纯规则 classifyBarSecid。lookupMapped 可注入，便于单测。
export function resolveBarSecid(position = {}, { lookupMapped = getMappedSecid } = {}) {
  const code = String(position.code || "").trim();
  const mapped = code ? lookupMapped(code) : null;
  if (mapped?.secid) {
    return { secid: mapped.secid, kind: mapped.kind, fetchCode: mapped.kind === "fund" ? code : mapped.secid, currency: "CNY" };
  }
  return classifyBarSecid(position);
}

// 采集编排：遍历当前持仓，按 secid 去重回补历史，落 daily_bars + secid_map。
// 单标的失败不影响其余；交易所判定但取不到数时回退试基金接口（纠正 market 标错，如 001557）。
export async function syncPortfolioBars({ fetchImpl = globalThis.fetch } = {}) {
  const positions = getPositions();
  const now = new Date().toISOString();
  const results = [];
  const done = new Set();

  for (const p of positions) {
    const resolved = resolveBarSecid(p);
    if (!resolved) { results.push({ code: p.code, name: p.name, ok: false, reason: "unsupported-or-no-secid" }); continue; }
    if (done.has(resolved.secid)) { results.push({ code: p.code, secid: resolved.secid, ok: true, reused: true }); continue; }
    try {
      let { secid, kind, fetchCode } = resolved;
      let bars = [];
      let truncated = false;
      let requests = 1;

      if (kind === "fund") {
        bars = await fetchFundNavHistory(fetchCode, { fetchImpl });
      } else {
        const r = await fetchHistoricalExchangeBars(secid, { fetchImpl });
        bars = r.bars; truncated = r.truncated; requests = r.requests;
        // 探测回退：交易所判定但无数据 → market 可能标错（实测 001557），试基金接口。
        if (!bars.length && /^\d{6}$/.test(String(p.code))) {
          const fundBars = await fetchFundNavHistory(p.code, { fetchImpl });
          if (fundBars.length) { bars = fundBars; secid = `OF.${p.code}`; kind = "fund"; }
        }
      }

      if (!bars.length) throw new Error("no-bars");
      upsertBars(secid, bars, now);
      saveSecidMap(p.code, secid, kind, now);
      done.add(secid);
      results.push({ code: p.code, name: p.name, secid, kind, ok: true, count: bars.length, truncated, requests });
    } catch (err) {
      results.push({ code: p.code, name: p.name, ok: false, reason: err.message });
    }
  }

  const summary = summarizePortfolioSync(results, now);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastPortfolioHistorySync", JSON.stringify(summary));
  return results;
}

// 汇总采集结果为快照（供 settings 落库与查询接口透传）。
export function summarizePortfolioSync(results = [], now = new Date().toISOString()) {
  const ok = results.filter((r) => r.ok && !r.reused);
  const failed = results.filter((r) => !r.ok);
  return {
    ranAt: now,
    total: results.length,
    succeeded: ok.length,
    failed: failed.length,
    reused: results.filter((r) => r.reused).length,
    truncatedSecids: ok.filter((r) => r.truncated).map((r) => r.secid),
    failures: failed.map((r) => ({ code: r.code, reason: r.reason })),
  };
}

// 读取上次采集快照（查询接口透传给前端）。
export function getPortfolioHistorySyncStatus() {
  const row = db.prepare("SELECT value FROM settings WHERE key='lastPortfolioHistorySync'").get();
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}
