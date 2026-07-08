// 一次性回填脚本：逐天同步飞书社群信号（跳过已入库天）。
// 用法：node --env-file=.env scripts/backfill-feishu-signals.js
import { syncCommunitySignals, summarizeSignalSync } from "../server/services/daily-job.js";

const force = process.argv.includes("--force");
const result = await syncCommunitySignals({ source: "backfill", force });
const summary = summarizeSignalSync(result);

console.log("ok:", summary.ok, "| method:", summary.extractionMethod);
console.log("processed dates:", JSON.stringify(summary.processedDates));
console.log("skipped dates  :", JSON.stringify(summary.skippedDates));
console.log("signal count   :", summary.signalCount);
if (summary.reason) console.log("reason:", summary.reason);
if (summary.extractionError) console.log("extractionError:", summary.extractionError);
