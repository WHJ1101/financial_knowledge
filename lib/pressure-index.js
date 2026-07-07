// 板块压力指数纯计算（.doc/板块压力监控模块设计与验收清单.md §3.3）。
// 输入各代理标的日线，输出主题的综合压力分 + 分项分 + 近30日序列 + 语义状态。
// 全程纯函数、无 I/O、无全局状态，便于单测（仿 src/lib/portfolio-analysis.test.js）。

export const PERCENTILE_WINDOW = 120; // 滚动百分位窗口（交易日）
export const RETURN_PERIOD = 5;       // 背离分项的收益率回看期
export const VOLUME_MA_PERIOD = 20;   // 量比的均量窗口
export const SERIES_POINTS = 30;      // 近 N 日综合分序列长度
export const UPPER_THRESHOLD = 70;    // 上穿报警阈值（百分位）
export const LOWER_THRESHOLD = 30;    // 下穿报警阈值（百分位）

// 主入口：bars 为 { secid: [{date,close,volume}] } 映射，config 为主题定义（见 pressure-monitor.js）。
export function computeThemePressure({ bars = {}, config }) {
  if (!config?.subs?.length) return emptyResult(config);

  const subSeries = config.subs.map((sub) => ({
    key: sub.key,
    label: sub.label,
    sub,
    danger: buildDangerSeries(sub, bars),
  }));
  const subScoreSeries = subSeries.map((item) => ({
    ...item,
    scores: rollingPercentileScores(item.danger),
  }));

  const compositeSeries = buildCompositeSeries(subScoreSeries);
  if (!compositeSeries.length) return emptyResult(config);

  const latest = compositeSeries[compositeSeries.length - 1];
  const scoreByDate = (scores) => scores.find((p) => p.date === latest.date) || null;
  const rawByDate = (danger) => danger.find((p) => p.date === latest.date) || null;

  const subScores = subScoreSeries.map((item) => {
    const point = scoreByDate(item.scores);
    const rawPoint = rawByDate(item.danger);
    return {
      key: item.key,
      label: item.label,
      score: point ? round1(point.score) : null,
      rawText: describeRaw(item.sub, rawPoint?.value),
    };
  });

  const volumeSub = subScores.find((s) => s.key === config.volumeKey) || subScores[0];

  return {
    date: latest.date,
    composite: round1(latest.composite),
    subScores,
    series30: compositeSeries.slice(-SERIES_POINTS).map((p) => ({ date: p.date, composite: round1(p.composite) })),
    status: buildStatus(compositeSeries, volumeSub?.score),
    crossing: detectCrossing(compositeSeries),
  };
}

// 依分项 kind 构造「越大越危险」的原始危险度序列 [{date,value}]。
function buildDangerSeries(sub, bars) {
  if (sub.kind === "volumeRatio") return volumeRatioSeries(bars[sub.secid] || []);
  if (sub.kind === "underperformance") return underperformanceSeries(bars[sub.sector] || [], bars[sub.baseline] || []);
  if (sub.kind === "spread") return spreadSeries(bars[sub.high] || [], bars[sub.low] || []);
  return [];
}

// 量比 = 成交量 / 20 日均量，direction=+1（放量越高越危险）。
function volumeRatioSeries(barsList) {
  const out = [];
  for (let i = VOLUME_MA_PERIOD - 1; i < barsList.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - VOLUME_MA_PERIOD + 1; j <= i; j++) {
      const v = barsList[j].volume;
      if (v == null || !Number.isFinite(v)) { ok = false; break; }
      sum += v;
    }
    const ma = sum / VOLUME_MA_PERIOD;
    const v = barsList[i].volume;
    if (!ok || !ma || v == null) continue;
    out.push({ date: barsList[i].date, value: v / ma });
  }
  return out;
}

// 板块跑输基准越多越危险：danger = retN(基准) − retN(板块)。板块弱于基准时为正。
function underperformanceSeries(sectorBars, baselineBars) {
  const aligned = alignByDate(sectorBars, baselineBars);
  const out = [];
  for (let i = RETURN_PERIOD; i < aligned.length; i++) {
    const retSector = returnRate(aligned[i].a, aligned[i - RETURN_PERIOD].a);
    const retBaseline = returnRate(aligned[i].b, aligned[i - RETURN_PERIOD].b);
    if (retSector == null || retBaseline == null) continue;
    out.push({ date: aligned[i].date, value: retBaseline - retSector });
  }
  return out;
}

// 期限结构 danger = close(high) − close(low)，如 VIX − VIX3M（backwardation 越大越危险）。
function spreadSeries(highBars, lowBars) {
  return alignByDate(highBars, lowBars).map((p) => ({ date: p.date, value: p.a - p.b }));
}

// 按 date inner-join 两条日线，返回 [{date, a:closeA, b:closeB}]（保持升序）。
function alignByDate(barsA, barsB) {
  const mapB = new Map(barsB.map((b) => [b.date, b.close]));
  const out = [];
  for (const a of barsA) {
    if (mapB.has(a.date)) out.push({ date: a.date, a: a.close, b: mapB.get(a.date) });
  }
  return out;
}

function returnRate(current, prev) {
  if (!Number.isFinite(current) || !Number.isFinite(prev) || !prev) return null;
  return current / prev - 1;
}

// 对危险度序列做滚动百分位归一化 → [{date, score∈[0,100]}]。窗口内当前值 ≤ 比例即为分位。
export function rollingPercentileScores(series, window = PERCENTILE_WINDOW) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - window + 1);
    const windowVals = [];
    for (let j = start; j <= i; j++) windowVals.push(series[j].value);
    out.push({ date: series[i].date, score: percentileRank(windowVals, series[i].value) });
  }
  return out;
}

export function percentileRank(values, current) {
  if (!values.length) return null;
  const countLE = values.filter((v) => v <= current).length;
  return (countLE / values.length) * 100;
}

// 跨分项按 date inner-join 后等权平均 → [{date, composite}]。
function buildCompositeSeries(subScoreSeries) {
  if (!subScoreSeries.length) return [];
  const maps = subScoreSeries.map((s) => new Map(s.scores.map((p) => [p.date, p.score])));
  const composite = [];
  for (const point of subScoreSeries[0].scores) {
    let sum = 0;
    let ok = true;
    for (const m of maps) {
      const score = m.get(point.date);
      if (score == null) { ok = false; break; }
      sum += score;
    }
    if (ok) composite.push({ date: point.date, composite: sum / maps.length });
  }
  return composite;
}

// 语义状态：综合分方向 × 量比高低 的四象限（规则生成，非 LLM）。
export function buildStatus(compositeSeries, volumeScore) {
  if (compositeSeries.length < 2) return "数据不足";
  const last = compositeSeries[compositeSeries.length - 1].composite;
  const prev = compositeSeries[compositeSeries.length - 2].composite;
  const compositeUp = last > prev;
  const volumeHigh = (volumeScore ?? 50) >= 50;
  if (compositeUp && volumeHigh) return "放量下跌，压力抬升中";
  if (!compositeUp && !volumeHigh) return "低量企稳，压力回落";
  if (compositeUp && !volumeHigh) return "缩量阴跌";
  return "放量反弹待确认";
}

// 跨阈值判定：仅看末尾两点，上穿 70 / 下穿 30 才报警（未跨返回 null，避免每日刷屏）。
export function detectCrossing(compositeSeries) {
  if (compositeSeries.length < 2) return null;
  const last = compositeSeries[compositeSeries.length - 1].composite;
  const prev = compositeSeries[compositeSeries.length - 2].composite;
  if (prev < UPPER_THRESHOLD && last >= UPPER_THRESHOLD) return "up-70";
  if (prev > LOWER_THRESHOLD && last <= LOWER_THRESHOLD) return "down-30";
  return null;
}

function describeRaw(sub, value) {
  if (value == null || !Number.isFinite(value)) return "数据不足";
  if (sub.kind === "volumeRatio") return `量比 ${value.toFixed(2)}`;
  if (sub.kind === "underperformance") return `5日超额 ${(-value * 100).toFixed(1)}%`;
  if (sub.kind === "spread") return `价差 ${value.toFixed(2)}`;
  return String(value);
}

function emptyResult(config) {
  return {
    date: null,
    composite: null,
    subScores: (config?.subs || []).map((sub) => ({ key: sub.key, label: sub.label, score: null, rawText: "数据不足" })),
    series30: [],
    status: "数据不足",
    crossing: null,
  };
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}
