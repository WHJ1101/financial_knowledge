import assert from "node:assert/strict";
import test from "node:test";

import { buildPortfolioSeries } from "./portfolio-series.js";

function dates(n, start = "2026-01-01") {
  const out = [];
  const d = new Date(start);
  for (let i = 0; i < n; i++) out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
  return out;
}

// P2-1 输出按日期升序，数值有限；空仓返回空序列。
test("P2-1 empty holdings returns empty series", () => {
  assert.deepEqual(buildPortfolioSeries([], {}), []);
  assert.deepEqual(buildPortfolioSeries([{ secid: "A", shares: 100, cost: 1, hasCost: true }], {}), []);
});

test("P2-1 ascending dates, all finite", () => {
  const ds = dates(3);
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 100, cost: 1, hasCost: true }],
    { A: [{ date: ds[2], close: 3 }, { date: ds[0], close: 1 }, { date: ds[1], close: 2 }] } // 乱序输入
  );
  assert.deepEqual(series.map((p) => p.date), ds); // 升序
  for (const p of series) {
    assert.ok(Number.isFinite(p.marketValue) && Number.isFinite(p.pnl));
  }
});

// P2-2 口径：marketValue = Σ shares×close；pnl 只对 hasCost 标的；pnlPct = pnl/totalCost×100。
test("P2-2 marketValue / pnl / pnlPct correct with known data", () => {
  const ds = dates(1);
  // A: 100 股 × 12 = 1200 市值，成本 100×10=1000 → pnl 200
  // B: 无成本 200 股 × 5 = 1000 市值，不计入盈亏
  const series = buildPortfolioSeries(
    [
      { secid: "A", shares: 100, cost: 10, hasCost: true },
      { secid: "B", shares: 200, cost: 0, hasCost: false },
    ],
    { A: [{ date: ds[0], close: 12 }], B: [{ date: ds[0], close: 5 }] }
  );
  const p = series[0];
  assert.equal(p.marketValue, 1200 + 1000); // 全部标的市值
  assert.equal(p.pnl, 1200 - 1000);          // 只对 hasCost 标的算差
  assert.equal(p.pnlPct, (200 / 1000) * 100);
});

// P2-3 forward-fill：某标的缺某交易日价格时用最近前值填充，不断点不产生 NaN。
test("P2-3 forward-fill fills gaps without NaN", () => {
  const ds = dates(3);
  // A 在 ds[1] 缺价，应沿用 ds[0] 的 close=10
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 10, cost: 1, hasCost: true }, { secid: "B", shares: 10, cost: 1, hasCost: true }],
    { A: [{ date: ds[0], close: 10 }, { date: ds[2], close: 20 }], B: [{ date: ds[0], close: 1 }, { date: ds[1], close: 1 }, { date: ds[2], close: 1 }] }
  );
  assert.equal(series[1].date, ds[1]);
  // ds[1]: A 用前值 10 → 100，B → 10 = 110
  assert.equal(series[1].marketValue, 110);
  for (const p of series) assert.ok(Number.isFinite(p.marketValue));
});

// P2-4 上市/成立前不虚增：标的首个净值点之前的日子不计入；coveredCount 单调递增。
test("P2-4 asset not counted before its first bar; coveredCount grows", () => {
  const ds = dates(3);
  // A 从 ds[0] 有数据，B 从 ds[2] 才上市
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 10, cost: 1, hasCost: true }, { secid: "B", shares: 10, cost: 1, hasCost: true }],
    { A: [{ date: ds[0], close: 10 }, { date: ds[1], close: 10 }, { date: ds[2], close: 10 }], B: [{ date: ds[2], close: 5 }] }
  );
  assert.equal(series[0].coveredCount, 1); // 仅 A
  assert.equal(series[0].marketValue, 100); // B 未入场，不虚增
  assert.equal(series[2].coveredCount, 2); // A + B
  assert.equal(series[2].marketValue, 100 + 50);
});

// P2-8 成分动态入场无假暴亏：成本基线随 S(t) 收敛，早期不出现巨额假亏。
test("P2-8 dynamic cost baseline avoids fake huge loss on staggered entry", () => {
  const ds = dates(3);
  // A 从 ds[0]，成本 10×100=1000；B 从 ds[2]，成本 10×1000=10000（占大头）
  // 若用全量固定成本 11000 作基线，ds[0] 只有 A 市值 1000 → pnl -10000 → -90% 假亏。
  // 正确：ds[0] 的 totalCost 只含 A=1000，市值≈成本 → pnlPct≈0。
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 100, cost: 10, hasCost: true }, { secid: "B", shares: 1000, cost: 10, hasCost: true }],
    { A: [{ date: ds[0], close: 10 }, { date: ds[1], close: 10 }, { date: ds[2], close: 10 }], B: [{ date: ds[2], close: 10 }] }
  );
  assert.equal(series[0].pnlPct, 0, "早期只含 A，市值=成本 → 0%，非 -90% 假亏");
  assert.ok(series[0].pnlPct > -50, "绝不出现 -90% 量级假暴亏");
  assert.equal(series[2].pnlPct, 0); // 成分齐后仍 0（价=成本）
});

// P2-7 输入 bars 乱序、重复日期、缺 close、负 close、重复 secid 时结果稳定，不产生 NaN/Infinity。
test("P2-7 robust to dirty bars (dup/neg/missing close)", () => {
  const ds = dates(2);
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 10, cost: 1, hasCost: true }],
    { A: [
      { date: ds[0], close: 10 },
      { date: ds[0], close: 12 },      // 同日重复 → 保留后者 12
      { date: ds[1], close: -5 },      // 负 close → 丢弃
      { date: ds[1], close: NaN },     // NaN → 丢弃
      { date: ds[1], close: 20 },      // 有效
    ] }
  );
  assert.equal(series[0].marketValue, 120); // ds[0] 用去重后的 12
  for (const p of series) {
    assert.ok(Number.isFinite(p.marketValue) && Number.isFinite(p.pnl));
    assert.ok(p.pnlPct === null || Number.isFinite(p.pnlPct));
  }
});

// pnlPct 无成本时为 null。
test("pnlPct is null when no cost", () => {
  const ds = dates(1);
  const series = buildPortfolioSeries(
    [{ secid: "A", shares: 10, cost: 0, hasCost: false }],
    { A: [{ date: ds[0], close: 10 }] }
  );
  assert.equal(series[0].pnlPct, null);
  assert.equal(series[0].pnl, 0);
});
