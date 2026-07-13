// 日更编排：社群信号同步 + 每日简报生成 + 运行状态落库。
// 从 server/index.js 迁出，网关层不再持有编排逻辑与 DB 直写。
import db, { DATA_DIR } from "./db.js";
import { appendLog } from "./logs.js";
import { isDailyBriefingTask } from "./task-kinds.js";
import { createDailyMarketBriefReport } from "./report-lifecycle.js";
import { getSettings } from "../routes/settings.js";
import { getTopCommunitySignals, replaceCommunitySignalSnapshot, hasFeishuSignalsForDate } from "../routes/signals.js";
import { runPressureMonitor, getPressureSnapshot } from "./pressure-monitor.js";
import { syncPortfolioBars, summarizePortfolioSync } from "./portfolio-history.js";
import { syncFeishuCommunitySignals } from "../../lib/communitySignalPipeline.js";
import { localDate } from "../../lib/datetime.js";
import { notifyDailyPressureBriefing } from "./feishu-notify.js";

export async function runDailyJob(source = "scheduled") {
  const today = localDate();
  const settings = getSettings();
  if (source === "scheduled" && settings.lastDailyRun === today) return { skipped: true, reason: "已执行过今日日更", reports: [] };

  const now = new Date();
  const signalSync = await syncCommunitySignals({ now, source });
  // 信号已逐天落库，简报统一取库里最新的置顶信号（含本次刚回填的天），不再区分本次是否有新增。
  const communitySignals = getTopCommunitySignals({ limit: 8, now });
  const reports = [await createDailyMarketBriefReport({ source, now, communitySignals, signalSync })];
  const pressure = await runPressureMonitorSafely(source);
  // 组合历史回补：与压力监控同构，失败仅记日志不阻断日更主流程。
  const portfolioHistory = await syncPortfolioBarsSafely(source);
  // 每日压力摘要推送：用最新快照现算后推飞书；内部吞异常记日志，不阻断日更。
  await notifyDailyPressureBriefing(getPressureSnapshot(), { now });
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyRun", JSON.stringify(today));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingRunAt", JSON.stringify(new Date().toISOString()));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingWindowEnd", JSON.stringify(reports[0].briefingWindow?.end || null));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingSourceStats", JSON.stringify(reports[0].sourceStats || []));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastCommunitySignalSync", JSON.stringify(summarizeSignalSync(signalSync)));
  const portfolioSummary = Array.isArray(portfolioHistory) ? summarizePortfolioSync(portfolioHistory) : portfolioHistory;
  appendLog("daily_job", `Daily job created ${reports.length} reports`, { source, signalSync: summarizeSignalSync(signalSync), portfolioHistory: portfolioSummary });
  return { skipped: false, reports, signalSync: summarizeSignalSync(signalSync), pressure, portfolioHistory: portfolioSummary };
}

// 压力监控失败不能阻断日更主流程（每日简报已生成），异常仅记日志。
async function runPressureMonitorSafely(source) {
  try {
    return await runPressureMonitor({ source });
  } catch (err) {
    appendLog("pressure_monitor", `Pressure monitor failed: ${err.message}`, { source });
    return { error: err.message };
  }
}

// 组合历史回补失败不能阻断日更主流程，异常仅记日志（仿 runPressureMonitorSafely）。
async function syncPortfolioBarsSafely(source) {
  try {
    return await syncPortfolioBars();
  } catch (err) {
    appendLog("portfolio_history", `Portfolio bars sync failed: ${err.message}`, { source });
    return { error: err.message };
  }
}

export async function runAutomationTask(task) {
  if (isDailyBriefingTask(task)) return runDailyJob("scheduled");
  appendLog("automation_task", `No executor configured for task: ${task.name || task.id}`, { id: task.id });
  return { skipped: true, reason: "当前任务尚未配置自动执行器", taskId: task.id };
}

export async function syncCommunitySignals({ now = new Date(), source = "manual", force = false } = {}) {
  // 逐天同步：已入库的 feishu 天直接跳过，只抽取缺失的天，避免每次取全量并重复落库。
  const shouldProcessDate = force ? () => true : (date) => !hasFeishuSignalsForDate(date);
  const result = await syncFeishuCommunitySignals({ dataDir: DATA_DIR, now, shouldProcessDate });

  // 按天分别快照落库：replaceCommunitySignalSnapshot 以 source+date+sourceTitle 为粒度覆盖，天与天互不干扰。
  let written = 0;
  for (const day of result.days || []) {
    if (day.signals?.length) written += replaceCommunitySignalSnapshot(day.signals).changed || 0;
  }

  appendLog(
    "community_signal_sync",
    result.ok
      ? `Synced ${written} community signals across ${result.processedDates?.length || 0} day(s)`
      : result.skipped ? `Community signal sync skipped: ${result.reason}` : `Community signal sync failed: ${result.reason}`,
    { source, ...summarizeSignalSync(result) }
  );
  return result;
}

export function summarizeSignalSync(result = {}) {
  return {
    ok: !!result.ok,
    skipped: !!result.skipped,
    provider: result.provider || "feishu",
    reason: result.reason || "",
    extractionMethod: result.extractionMethod || "",
    extractionError: result.extractionError || "",
    signalCount: result.signals?.length || 0,
    processedDates: result.processedDates || [],
    skippedDates: result.skippedDates || [],
    sourceTitle: result.source?.title || "",
    outputPath: result.source?.outputPath || ""
  };
}
