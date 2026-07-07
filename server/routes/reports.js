import db from "../services/db.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { localDate, localDateTimeWithWeekday } from "../../lib/datetime.js";
import { isLlmConfigured } from "../../lib/llmClient.js";
import { appendLog } from "../services/logs.js";
import { deleteReportFile, reportFileExists as fileExists } from "../services/report-file-store.js";
import { deleteReportAssetLinks, syncAutoReportAssetLinks } from "./report-assets.js";

// 版本号从 package.json 读取，避免与源码里的硬编码漂移。
const APP_VERSION = readAppVersion();

function readAppVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function startOfDayOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return localDate(d);
}

export function getStatus() {
  const now = new Date();
  const today = localDate(now);
  const nowDisplay = localDateTimeWithWeekday(now);
  const sevenDaysAgo = startOfDayOffset(-6);
  const visibleReports = visibleReportRows(db.prepare("SELECT * FROM reports ORDER BY created_at DESC").all()).map(formatReport);
  const todayUpdates = visibleReports.filter((report) => report.localDate === today).length;
  const unreadCount = visibleReports.filter((report) => report.status !== "read").length;
  const recentCount = visibleReports.filter((report) => report.localDate >= sevenDaysAgo).length;
  const reportCount = visibleReports.length;
  const automationCount = visibleReports.filter((report) => report.origin === "automation").length;
  const manualCount = visibleReports.filter((report) => report.origin === "manual").length;
  const settings = getSettings();
  const llmConfigured = isLlmConfigured();

  return {
    app: "financial_knowledge", version: APP_VERSION,
    now: nowDisplay,
    today,
    nowIso: now.toISOString(),
    nowDisplay,
    todayUpdates, unreadCount, recentCount, reportCount,
    originCounts: { automation: automationCount, manual: manualCount },
    llm: { configured: llmConfigured },
    settings: { ...settings, llmConfigured }
  };
}

export function getReports(query, origin) {
  let sql = "SELECT * FROM reports WHERE 1=1";
  const params = [];
  if (origin && origin !== "all") { sql += " AND origin=?"; params.push(origin); }
  if (query) { sql += " AND (title LIKE ? OR topic LIKE ? OR summary LIKE ? OR tags LIKE ?)"; const q = `%${query}%`; params.push(q, q, q, q); }
  sql += " ORDER BY created_at DESC LIMIT 400";
  return visibleReportRows(db.prepare(sql).all(...params)).slice(0, 200).map(formatReport);
}

export function getReport(id) {
  const row = db.prepare("SELECT * FROM reports WHERE id=?").get(id);
  if (!row) return null;
  return formatReport(reportFileExists(row) ? row : findReplacementReport(row) || row);
}

export function markReportRead(id) {
  db.prepare("UPDATE reports SET status='read', updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getReport(id);
}

export function toggleReportStar(id) {
  db.prepare("UPDATE reports SET starred = CASE WHEN starred=1 THEN 0 ELSE 1 END, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getReport(id);
}

export function archiveReport(id) {
  db.prepare("UPDATE reports SET archived = CASE WHEN archived=1 THEN 0 ELSE 1 END, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getReport(id);
}

export function deleteReport(id) {
  const row = db.prepare("SELECT * FROM reports WHERE id=?").get(id);
  if (!row) return null;

  // 文件删除不可回滚，放在事务外先执行；DB 侧的三步（删关联、删报告、写日志）
  // 必须原子完成，任一步失败则整体回滚，避免"关联已删但报告还在"的中间态。
  const fileDeleted = deleteReportFile(row.file);
  const runDelete = db.transaction(() => {
    deleteReportAssetLinks(id);
    db.prepare("DELETE FROM reports WHERE id=?").run(id);
    appendLog("report_delete", "Deleted report: " + row.title, { id: row.id, title: row.title, file: row.file, fileDeleted });
  });
  runDelete();
  return { deleted: true, fileDeleted };
}

// options.knownAssets：批量导入时由调用方一次查询后传入，避免每篇报告重查已知资产表。
export function insertReport(report, options = {}) {
  const existing = db.prepare("SELECT starred, archived FROM reports WHERE id=?").get(report.id);
  db.prepare(`INSERT OR REPLACE INTO reports (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    report.id, report.title, report.topic, report.type, report.typeLabel, report.summary,
    JSON.stringify(report.tags||[]), report.status||"new", report.starred ?? existing?.starred ?? 0, report.archived ?? existing?.archived ?? 0, report.source, report.origin,
    report.originLabel, report.localDate, report.file, report.wikiPath, report.accent,
    JSON.stringify(report.highlights||[]), report.createdAt, report.updatedAt||report.createdAt
  );
  syncAutoReportAssetLinks(report, options);
}

export function getAllReportsForPipeline() {
  return db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100").all().map(formatReport);
}

function formatReport(row) {
  return {
    id: row.id, title: row.title, topic: row.topic, type: row.type,
    typeLabel: row.type_label, summary: row.summary,
    tags: JSON.parse(row.tags || "[]"), status: row.status,
    starred: !!row.starred, archived: !!row.archived,
    source: row.source, origin: row.origin, originLabel: row.origin_label,
    localDate: row.local_date, file: row.file, wikiPath: row.wiki_path,
    accent: row.accent, highlights: JSON.parse(row.highlights || "[]"),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function visibleReportRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!reportFileExists(row)) return false;
    const key = `${row.local_date}|${row.title}|${row.type}|${row.origin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findReplacementReport(row) {
  return db.prepare(`
    SELECT * FROM reports
    WHERE local_date=? AND title=? AND type=? AND origin=?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(row.local_date, row.title, row.type, row.origin).find(reportFileExists);
}

function reportFileExists(row) {
  return fileExists(row?.file);
}
