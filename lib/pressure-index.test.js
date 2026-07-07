import assert from "node:assert/strict";
import test from "node:test";

import {
  computeThemePressure,
  rollingPercentileScores,
  percentileRank,
  detectCrossing,
  buildStatus,
  VOLUME_MA_PERIOD,
} from "./pressure-index.js";

// 造一段等差日期序列
function dates(n, start = "2026-01-01") {
  const out = [];
  const d = new Date(start);
  for (let i = 0; i < n; i++) {
    out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// P2-2 滚动百分位：窗口内最大值→100，最小值→接近下限
test("rollingPercentileScores: max value scores 100, min scores low", () => {
  const ds = dates(5);
  const series = [10, 20, 30, 40, 50].map((v, i) => ({ date: ds[i], value: v }));
  const scores = rollingPercentileScores(series, 120);
  assert.equal(scores.at(-1).score, 100); // 50 是历史最大 → 全部 ≤ 它 → 100
  assert.equal(scores[0].score, 100);       // 第一个点窗口只有自己 → 100
});

test("percentileRank: median-ish value scores around 50-60", () => {
  const values = [1, 2, 3, 4, 5];
  assert.equal(percentileRank(values, 3), 60); // 3 个 ≤ 3（1,2,3）/ 5 = 60
  assert.equal(percentileRank(values, 5), 100);
  assert.equal(percentileRank(values, 0), 0);
});

// P2-1 综合分 ∈ [0,100]，分项齐全，series30 非空
test("computeThemePressure: composite in range, subs complete, series non-empty", () => {
  const n = 160;
  const ds = dates(n);
  // 板块：温和上涨；防御：更强上涨（→板块跑输→危险度上升）；大盘：温和
  const sector = ds.map((date, i) => ({ date, close: 100 + i * 0.1, volume: 1000 + i * 5 }));
  const defensive = ds.map((date, i) => ({ date, close: 100 + i * 0.3, volume: 500 }));
  const broad = ds.map((date, i) => ({ date, close: 100 + i * 0.2, volume: 800 }));
  const config = {
    volumeKey: "vr",
    subs: [
      { key: "vr", label: "量比", kind: "volumeRatio", secid: "S" },
      { key: "def", label: "高beta vs 防御", kind: "underperformance", sector: "S", baseline: "D" },
      { key: "broad", label: "大盘 vs 板块", kind: "underperformance", sector: "S", baseline: "B" },
    ],
  };
  const res = computeThemePressure({ bars: { S: sector, D: defensive, B: broad }, config });
  assert.ok(res.composite >= 0 && res.composite <= 100, "composite in [0,100]");
  assert.equal(res.subScores.length, 3);
  assert.ok(res.subScores.every((s) => s.score == null || (s.score >= 0 && s.score <= 100)));
  assert.ok(res.series30.length > 0);
  assert.ok(res.date);
});

// P2-3 方向统一：板块跑输防御/大盘时，背离分项危险度分数应偏高
test("underperformance direction: sector lagging baseline yields high danger score", () => {
  const n = 160;
  const ds = dates(n);
  // 前半段板块与防御同步；末尾板块骤跌 → 跑输 → danger 升高 → 高分位
  const sector = ds.map((date, i) => ({ date, close: i < 150 ? 100 + i * 0.1 : 100 + 150 * 0.1 - (i - 149) * 2, volume: 1000 }));
  const defensive = ds.map((date, i) => ({ date, close: 100 + i * 0.1, volume: 500 }));
  const config = {
    volumeKey: "vr",
    subs: [
      { key: "vr", label: "量比", kind: "volumeRatio", secid: "S" },
      { key: "def", label: "高beta vs 防御", kind: "underperformance", sector: "S", baseline: "D" },
    ],
  };
  const res = computeThemePressure({ bars: { S: sector, D: defensive }, config });
  const defScore = res.subScores.find((s) => s.key === "def").score;
  assert.ok(defScore >= 80, `expected high underperformance score, got ${defScore}`);
});

// P2-4 按 date inner-join 对齐：缺某日不产生 NaN
test("computeThemePressure: missing dates aligned without NaN", () => {
  const n = 160;
  const ds = dates(n);
  const sector = ds.map((date, i) => ({ date, close: 100 + i * 0.1, volume: 1000 }));
  // 防御缺失中间一天
  const defensive = ds.filter((_, i) => i !== 80).map((date, i) => ({ date, close: 100 + i * 0.1, volume: 500 }));
  const config = {
    volumeKey: "vr",
    subs: [
      { key: "vr", label: "量比", kind: "volumeRatio", secid: "S" },
      { key: "def", label: "背离", kind: "underperformance", sector: "S", baseline: "D" },
    ],
  };
  const res = computeThemePressure({ bars: { S: sector, D: defensive }, config });
  assert.ok(Number.isFinite(res.composite), "composite is finite");
  assert.ok(res.subScores.every((s) => s.score == null || Number.isFinite(s.score)));
});

// P2-5 跨阈值判定
test("detectCrossing: up-70 and down-30", () => {
  assert.equal(detectCrossing([{ date: "d1", composite: 65 }, { date: "d2", composite: 72 }]), "up-70");
  assert.equal(detectCrossing([{ date: "d1", composite: 35 }, { date: "d2", composite: 28 }]), "down-30");
  assert.equal(detectCrossing([{ date: "d1", composite: 50 }, { date: "d2", composite: 55 }]), null);
  assert.equal(detectCrossing([{ date: "d1", composite: 72 }, { date: "d2", composite: 75 }]), null); // 已在阈值上方，不重复报警
});

// P2-6 语义状态四象限（直接测 buildStatus，覆盖全部四象限）
test("buildStatus: four quadrants via composite direction x volume", () => {
  const rising = [{ date: "d1", composite: 40 }, { date: "d2", composite: 60 }];
  const falling = [{ date: "d1", composite: 60 }, { date: "d2", composite: 40 }];
  assert.equal(buildStatus(rising, 80), "放量下跌，压力抬升中");   // 分↑ + 高量比
  assert.equal(buildStatus(falling, 20), "低量企稳，压力回落");   // 分↓ + 低量比
  assert.equal(buildStatus(rising, 20), "缩量阴跌");             // 分↑ + 低量比
  assert.equal(buildStatus(falling, 80), "放量反弹待确认");       // 分↓ + 高量比
  assert.equal(buildStatus([{ date: "d1", composite: 50 }]), "数据不足");
});

// P2-1 边界：空 bars 返回结构完整的降级结果
test("computeThemePressure: empty bars returns complete degraded shape", () => {
  const config = { volumeKey: "vr", subs: [{ key: "vr", label: "量比", kind: "volumeRatio", secid: "S" }] };
  const res = computeThemePressure({ bars: {}, config });
  assert.equal(res.composite, null);
  assert.equal(res.subScores.length, 1);
  assert.equal(res.series30.length, 0);
  assert.equal(res.crossing, null);
});

// 量比需要至少 VOLUME_MA_PERIOD 条数据
test("volumeRatio requires at least MA period bars", () => {
  const ds = dates(VOLUME_MA_PERIOD - 1);
  const config = { volumeKey: "vr", subs: [{ key: "vr", label: "量比", kind: "volumeRatio", secid: "S" }] };
  const res = computeThemePressure({ bars: { S: ds.map((date) => ({ date, close: 100, volume: 1000 })) }, config });
  assert.equal(res.composite, null);
});
