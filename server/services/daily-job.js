// 日更编排：社群信号同步 + 每日简报生成 + 运行状态落库。
// 从 server/index.js 迁出，网关层不再持有编排逻辑与 DB 直写。
import db, { DATA_DIR } from "./db.js";
import { appendLog } from "./logs.js";
import { isDailyBriefingTask } from "./task-kinds.js";
import { createDailyMarketBriefReport } from "./report-lifecycle.js";
import { getSettings } from "../routes/settings.js";
import { getTopCommunitySignals, replaceCommunitySignalSnapshot } from "../routes/signals.js";
import { runPressureMonitor, getPressureSnapshot } from "./pressure-monitor.js";
import { syncFeishuCommunitySignals } from "../../lib/communitySignalPipeline.js";
import { localDate } from "../../lib/datetime.js";
import { notifyDailyPressureBriefing } from "./feishu-notify.js";

export async function runDailyJob(source = "scheduled") {
  const today = localDate();
  const settings = getSettings();
  if (source === "scheduled" && settings.lastDailyRun === today) return { skipped: true, reason: "已执行过今日日更", reports: [] };

  const now = new Date();
  const signalSync = await syncCommunitySignals({ now, source });
  const communitySignals = signalSync.signals?.length
    ? signalSync.signals
    : getTopCommunitySignals({ limit: 8, now });
  const reports = [await createDailyMarketBriefReport({ source, now, communitySignals, signalSync })];
  const pressure = await runPressureMonitorSafely(source);
  // 每日压力摘要推送：用最新快照现算后推飞书；内部吞异常记日志，不阻断日更。
  await notifyDailyPressureBriefing(getPressureSnapshot(), { now });
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyRun", JSON.stringify(today));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingRunAt", JSON.stringify(new Date().toISOString()));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingWindowEnd", JSON.stringify(reports[0].briefingWindow?.end || null));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastDailyBriefingSourceStats", JSON.stringify(reports[0].sourceStats || []));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("lastCommunitySignalSync", JSON.stringify(summarizeSignalSync(signalSync)));
  appendLog("daily_job", `Daily job created ${reports.length} reports`, { source, signalSync: summarizeSignalSync(signalSync) });
  return { skipped: false, reports, signalSync: summarizeSignalSync(signalSync), pressure };
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

export async function runAutomationTask(task) {
  if (isDailyBriefingTask(task)) return runDailyJob("scheduled");
  appendLog("automation_task", `No executor configured for task: ${task.name || task.id}`, { id: task.id });
  return { skipped: true, reason: "当前任务尚未配置自动执行器", taskId: task.id };
}

export async function syncCommunitySignals({ now = new Date(), source = "manual" } = {}) {
  const result = await syncFeishuCommunitySignals({ dataDir: DATA_DIR, now });
  if (result.signals?.length) replaceCommunitySignalSnapshot(result.signals);
  appendLog(
    "community_signal_sync",
    result.ok
      ? `Synced ${result.signals.length} community signals`
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
    sourceTitle: result.source?.title || "",
    outputPath: result.source?.outputPath || ""
  };
}
