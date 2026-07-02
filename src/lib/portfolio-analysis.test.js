import assert from "node:assert/strict";
import test from "node:test";

import { buildHoldings, sortHoldings, getOverview, buildPortfolioAnalysis, riskLevel, actionLabel } from "./portfolio-analysis.js";

test("buildHoldings computes pnl, weight and coverage flags", () => {
  const rows = buildHoldings(
    [{ code: "A", shares: 100, cost: 10 }, { code: "B", shares: 50, cost: 0 }],
    { A: { price: 12 }, B: { price: 20 } }
  );
  const a = rows.find(r => r.code === "A");
  assert.equal(a.marketValue, 1200);
  assert.equal(a.costValue, 1000);
  assert.equal(a.pnl, 200);
  assert.equal(a.hasCost, true);
  const b = rows.find(r => r.code === "B");
  assert.equal(b.hasCost, false);
  assert.equal(b.pnl, null); // 无成本不计盈亏
  // 权重之和约等于 100
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.weight, 0) - 100) < 0.001);
});

test("sortHoldings by marketValue desc, nulls last", () => {
  const rows = [{ marketValue: 100 }, { marketValue: 300 }, { marketValue: 200 }];
  const sorted = sortHoldings(rows, { key: "marketValue", direction: "desc" });
  assert.deepEqual(sorted.map(r => r.marketValue), [300, 200, 100]);
});

test("sortHoldings default keeps original order", () => {
  const rows = [{ marketValue: 1 }, { marketValue: 3 }];
  assert.equal(sortHoldings(rows, { key: "default" }), rows);
});

test("getOverview aggregates pnl and risk counts", () => {
  const holdings = buildHoldings([{ code: "A", shares: 100, cost: 10, risk: "跌破支撑将止损" }], { A: { price: 9 } });
  const ov = getOverview(holdings, [], []);
  assert.equal(ov.positionCount, 1);
  assert.equal(ov.highRiskCount, 1); // risk 文案命中 high
  assert.ok(ov.pnl < 0);
});

test("riskLevel classifies by keywords", () => {
  assert.equal(riskLevel("跌破止损线"), "high");
  assert.equal(riskLevel("需求不及预期"), "medium");
  assert.equal(riskLevel("稳健持有"), "low");
  assert.equal(riskLevel(""), "low");
});

test("actionLabel reflects status then text", () => {
  assert.equal(actionLabel("", "analyzing"), "分析中");
  assert.equal(actionLabel("建议止盈", ""), "止盈");
  assert.equal(actionLabel("", ""), "待分析");
});

test("buildPortfolioAnalysis flags concentration on single holding", () => {
  const holdings = buildHoldings([{ code: "A", shares: 100, cost: 10 }], { A: { price: 12 } });
  const analysis = buildPortfolioAnalysis(holdings);
  assert.equal(analysis.count, 1);
  assert.equal(analysis.maxWeight, 100);
  assert.ok(analysis.healthScore < 100); // 单仓集中度触发扣分
  assert.ok(Array.isArray(analysis.themeRows));
});
