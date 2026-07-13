// 组合市值 / 盈亏走势曲线纯计算（.doc/持仓市值走势曲线设计与验收清单.md §4.2）。
// 输入当前持仓结构 + 各标的历史前复权价/净值，输出逐日 [{date,marketValue,pnl,pnlPct,coveredCount}]。
// 口径（§1.2）：某日市值 = Σ_{i∈S(t)} 当前 shares_i × 该日前复权价_i；
//   S(t) = 截至 t 日已出现过首个价格点的标的集合（成分随历史逐日入场，避免上市前虚增）。
//   成本基线随 S(t) 动态收敛：totalCost(t) = Σ_{i∈S(t) 且 hasCost} shares_i × cost_i，
//   分子(市值)与分母(成本)始终对同一集合，否则 range=all 早期出现 -90% 假暴亏（§1.2.1 实测）。
// 全程纯函数、无 I/O，仿 lib/pressure-index.js，便于单测。

// 输入：holdings=[{secid, shares, cost, hasCost}], barsBySecid={secid:[{date,close}]（升序）}
// 输出：[{date, marketValue, pnl, pnlPct, coveredCount}]，按日期升序。
export function buildPortfolioSeries(holdings = [], barsBySecid = {}) {
  if (!holdings.length) return [];

  // 每标的：清洗出「日期升序、close 为正有限、同日去重」的 date→close 映射，并记录首日。
  const prepared = holdings.map((h) => {
    const map = new Map();
    for (const bar of barsBySecid[h.secid] || []) {
      const close = Number(bar?.close);
      if (!bar?.date || !Number.isFinite(close) || close <= 0) continue;
      map.set(bar.date, close); // 同日后写覆盖先写 → 保留最后一个有效点
    }
    const dates = Array.from(map.keys()).sort();
    return {
      shares: Number(h.shares || 0),
      cost: Number(h.cost || 0),
      hasCost: !!h.hasCost && Number(h.cost || 0) > 0,
      map,
      firstDate: dates[0] || null,
    };
  });

  // 全体标的 date 并集（升序）。
  const allDates = new Set();
  for (const p of prepared) for (const d of p.map.keys()) allDates.add(d);
  const dates = Array.from(allDates).sort();
  if (!dates.length) return [];

  // 每标的一个 forward-fill 游标：lastClose 为最近的已知前值，started 标记是否已入场。
  const cursors = prepared.map(() => ({ lastClose: null, started: false }));

  const out = [];
  for (const date of dates) {
    let marketValue = 0;   // S(t) 内全部标的市值（用于「市值」曲线）
    let costedValue = 0;   // S(t) 内 hasCost 标的市值（用于盈亏）
    let totalCost = 0;     // S(t) 内 hasCost 标的成本
    let coveredCount = 0;

    for (let k = 0; k < prepared.length; k++) {
      const p = prepared[k];
      const c = cursors[k];
      // 标的首个价格点当天起才计入；之后用最近前值 forward-fill。
      if (p.map.has(date)) { c.lastClose = p.map.get(date); c.started = true; }
      if (!c.started) continue;

      coveredCount += 1;
      const value = p.shares * c.lastClose;
      marketValue += value;
      if (p.hasCost) {
        costedValue += value;
        totalCost += p.shares * p.cost;
      }
    }

    const pnl = costedValue - totalCost;
    out.push({
      date,
      marketValue,
      pnl,
      pnlPct: totalCost ? (pnl / totalCost) * 100 : null,
      coveredCount,
    });
  }
  return out;
}
