// 组合市值 / 盈亏走势曲线查询（.doc/持仓市值走势曲线设计与验收清单 §4.4）。
// 读当前持仓 → getAllBars 取完整历史 → buildPortfolioSeries 现算 → range 截取 + coverage/asOf。
// 查询层只读 daily_bars，不联网探测（低时延）；归类走 resolveBarSecid（先查 secid_map）。
import { getPositions } from "./stocks.js";
import { getAllBars } from "../services/kline-store.js";
import { resolveBarSecid, getPortfolioHistorySyncStatus } from "../services/portfolio-history.js";
import { buildPortfolioSeries } from "../../lib/portfolio-series.js";
import { localDate } from "../../lib/datetime.js";

const RANGE_DAYS = { "6m": 190 }; // 半年约 126 交易日，留冗余按自然日 190 截取
const DAY_MS = 24 * 60 * 60 * 1000;

export function getPortfolioHistory({ range = "6m", now = new Date() } = {}) {
  if (range !== "6m" && range !== "all") {
    throw Object.assign(new Error("range must be 6m or all"), { statusCode: 400 });
  }
  const positions = getPositions();
  const holdings = [];
  const barsBySecid = {};
  const skipped = [];
  const assets = [];

  for (const p of positions) {
    const resolved = resolveBarSecid(p);
    if (!resolved) {
      skipped.push({ code: p.code, name: p.name, reason: "unsupported-or-no-secid" });
      continue;
    }
    const bars = getAllBars(resolved.secid);
    if (!bars.length) {
      skipped.push({ code: p.code, name: p.name, secid: resolved.secid, reason: "no-bars" });
      continue;
    }
    holdings.push({
      secid: resolved.secid,
      shares: Number(p.shares || 0),
      cost: Number(p.cost || 0),
      hasCost: Number(p.cost || 0) > 0,
    });
    barsBySecid[resolved.secid] = bars;
    assets.push({ code: p.code, name: p.name, secid: resolved.secid, firstDate: bars[0].date, lastDate: bars.at(-1).date, barCount: bars.length });
  }

  let series = buildPortfolioSeries(holdings, barsBySecid);
  const asOf = series.at(-1)?.date || null;
  // 成分全齐日：coveredCount 首次等于 holdings.length 的日期（range=all 早于此日的区间成分未齐，前端须标注）。
  const fullCoverageSince = holdings.length ? (series.find((pt) => pt.coveredCount >= holdings.length)?.date || null) : null;

  if (range === "6m") {
    const cutoff = localDate(new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS));
    series = series.filter((pt) => pt.date >= cutoff);
  }

  for (const asset of assets) {
    asset.staleDays = asOf ? calendarDaysBetween(asset.lastDate, asOf) : null;
  }

  const totalCost = positions.reduce((sum, p) => sum + (Number(p.cost) > 0 ? Number(p.shares || 0) * Number(p.cost) : 0), 0);
  const coveredCost = holdings.reduce((sum, h) => sum + (h.hasCost ? h.shares * h.cost : 0), 0);

  return {
    range,
    basis: "current-holdings",
    calculationScope: holdings.length === positions.length ? "current-holdings" : "covered-holdings",
    asOf,
    fullCoverageSince,
    syncStatus: getPortfolioHistorySyncStatus(),
    series,
    coverage: {
      total: positions.length,
      covered: holdings.length,
      positionCoverage: positions.length ? (holdings.length / positions.length) * 100 : 100,
      costCoverage: totalCost ? (coveredCost / totalCost) * 100 : 100,
      skipped,
      assets,
    },
  };
}

function calendarDaysBetween(start, end) {
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS));
}
