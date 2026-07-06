import { writeReportFile } from "./report-file-store.js";
import { appendLog } from "./logs.js";
import { insertReport } from "../routes/reports.js";

export async function saveReport({ report, html, logType, logMessage, logMeta = {} }) {
  if (!report?.file) throw Object.assign(new Error("report.file required"), { statusCode: 500 });
  await writeReportFile(report.file, html);
  insertReport(report);
  if (logType) {
    appendLog(logType, logMessage || "Saved report: " + report.title, { id: report.id, ...logMeta });
  }
  return report;
}
