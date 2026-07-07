// 板块压力监控编排（.doc/板块压力监控模块设计与验收清单.md §3.1）。
// 读 daily_bars → pressure-index 现算两主题 → 跨阈值时写入 community_signals 复用验证闭环。
// 挂在日更（daily-job.js）收盘后执行；失败仅记日志，不阻断每日简报主流程。
import db from "./db.js";
import { appendLog } from "./logs.js";
import { syncDailyBars, getBars } from "./kline-store.js";
import { computeThemePressure, UPPER_THRESHOLD, LOWER_THRESHOLD } from "../../lib/pressure-index.js";
import { replaceCommunitySignalSnapshot } from "../routes/signals.js";
import { localDate } from "../../lib/datetime.js";
import { notifyPressureCrossings } from "./feishu-notify.js";

// 两个固定主题的代理标的与分项定义（MVP：A股 3 分项 / 美股 4 分项）。
export const THEME_CONFIGS = [
  {
    id: "a-semi",
    name: "A股半导体",
    market: "A股",
    volumeKey: "vr",
    subs: [
      { key: "vr", label: "量比", kind: "volumeRatio", secid: "1.512480" },
      { key: "def", label: "半导体 vs 红利", kind: "underperformance", sector: "1.512480", baseline: "1.510880" },
      { key: "broad", label: "沪深300 vs 半导体", kind: "underperformance", sector: "1.512480", baseline: "1.000300" },
    ],
  },
  {
    id: "us-semi",
    name: "美股半导体",
    market: "美股",
    volumeKey: "vr",
    subs: [
      { key: "vr", label: "SOXX 量比", kind: "volumeRatio", secid: "105.SOXX" },
      { key: "def", label: "SOXX vs XLU", kind: "underperformance", sector: "105.SOXX", baseline: "107.XLU" },
      { key: "broad", label: "SPY vs SOXX", kind: "underperformance", sector: "105.SOXX", baseline: "107.SPY" },
      { key: "vix", label: "VIX − VIX3M", kind: "spread", high: "YAHOO.VIX", low: "YAHOO.VIX3M" },
    ],
  },
];

// 汇总所有主题涉及的去重 secid（供 syncDailyBars 一次拉齐）。
export function allSecids() {
  const set = new Set();
  for (const theme of THEME_CONFIGS) {
    for (const sub of theme.subs) {
      for (const key of ["secid", "sector", "baseline", "high", "low"]) {
        if (sub[key]) set.add(sub[key]);
      }
    }
  }
  return Array.from(set);
}

// 现算所有主题的压力快照（供 /api/pressure 与 runPressureMonitor 复用）。
export function getPressureSnapshot() {
  const secids = allSecids();
  const bars = Object.fromEntries(secids.map((secid) => [secid, getBars(secid)]));
  return THEME_CONFIGS.map((config) => ({
    id: config.id,
    name: config.name,
    market: config.market,
    secids: themeSecids(config),
    ...computeThemePressure({ bars, config }),
  }));
}

// 主题涉及的去重 secid（作为信号 relatedAssets，供决策/关联使用）。
function themeSecids(config) {
  const set = new Set();
  for (const sub of config.subs) {
    for (const key of ["secid", "sector", "baseline", "high", "low"]) {
      if (sub[key]) set.add(sub[key]);
    }
  }
  return Array.from(set);
}

// 日更编排入口：拉日线 → 现算 → 跨阈值写信号 → 快照落 settings。异常向上抛由 daily-job 兜底记录。
export async function runPressureMonitor({ source = "scheduled", fetchImpl = globalThis.fetch } = {}) {
  const syncResults = await syncDailyBars(allSecids(), { fetchImpl });
  const themes = getPressureSnapshot();
  const now = new Date();

  // 两主题共用同一 source+date+sourceTitle，必须一次性快照写入，否则后写的会删掉先写的。
  const crossingSignals = themes.filter((t) => t.crossing).map((t) => buildCrossingSignal(t, now));
  const signalsWritten = crossingSignals.length ? (replaceCommunitySignalSnapshot(crossingSignals).changed || 0) : 0;

  // 跨阈值时推送飞书告警；内部已吞异常并记日志，不影响监控主流程。
  const pushResult = await notifyPressureCrossings(themes, { now, fetchImpl });

  const summary = {
    ranAt: now.toISOString(),
    themes: themes.map((t) => ({ id: t.id, composite: t.composite, crossing: t.crossing, status: t.status })),
    signalsWritten,
    feishuPush: pushResult,
    syncFailures: syncResults.filter((r) => !r.ok).map((r) => ({ secid: r.secid, error: r.error })),
  };
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastPressureRun", JSON.stringify(summary));
  appendLog("pressure_monitor", `Pressure monitor ran (${signalsWritten} signals)`, { source, ...summary });
  return summary;
}

// 构造一条跨阈值的 community_signals 记录，进入现有「待验证/已证实/已证伪」体系。
function buildCrossingSignal(theme, now) {
  const isUp = theme.crossing === "up-70";
  const leader = [...theme.subScores].filter((s) => s.score != null).sort((a, b) => b.score - a.score)[0];
  const date = localDate(now);
  const summary = isUp
    ? `${theme.name}压力指数上穿 ${UPPER_THRESHOLD}（${theme.composite}），${theme.status}`
    : `${theme.name}压力指数下穿 ${LOWER_THRESHOLD}（${theme.composite}），${theme.status}`;
  const evidence = `主导分项：${theme.subScores.map((s) => `${s.label} ${s.score ?? "-"}（${s.rawText}）`).join("；")}`;

  return {
    id: `pressure-${theme.id}-${date}`,
    date,
    source: "pressure-monitor",
    sourceTitle: "板块压力监控",
    theme: theme.name,
    industry: theme.market,
    relatedAssets: theme.secids || [],
    signalType: isUp ? "压力上穿" : "压力下穿",
    summary,
    evidence,
    confidence: "medium",
    verificationStatus: "待验证",
    importance: isUp ? 5 : 4,
    observedAt: now.toISOString(),
    importedAt: now.toISOString(),
    metadata: { composite: theme.composite, crossing: theme.crossing, leader: leader?.key || null },
  };
}
