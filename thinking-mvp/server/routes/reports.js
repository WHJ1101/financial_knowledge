import db from "../services/db.js";

const TIME_ZONE = "Asia/Shanghai";

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function startOfDayOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function getStatus() {
  const today = localDate();
  const sevenDaysAgo = startOfDayOffset(-6);
  const todayUpdates = db.prepare("SELECT COUNT(*) as c FROM reports WHERE local_date=?").get(today).c;
  const unreadCount = db.prepare("SELECT COUNT(*) as c FROM reports WHERE status != 'read'").get().c;
  const recentCount = db.prepare("SELECT COUNT(*) as c FROM reports WHERE local_date >= ?").get(sevenDaysAgo).c;
  const reportCount = db.prepare("SELECT COUNT(*) as c FROM reports").get().c;
  const automationCount = db.prepare("SELECT COUNT(*) as c FROM reports WHERE origin='automation'").get().c;
  const manualCount = db.prepare("SELECT COUNT(*) as c FROM reports WHERE origin='manual'").get().c;
  const enabled = db.prepare("SELECT value FROM settings WHERE key='automationEnabled'").get();

  return {
    app: "thinking-mvp", version: "0.2.0",
    now: localDateTime(),
    todayUpdates, unreadCount, recentCount, reportCount,
    originCounts: { automation: automationCount, manual: manualCount },
    settings: {
      automationEnabled: enabled ? JSON.parse(enabled.value) : false,
      lastDailyRun: getSetting("lastDailyRun"),
      schedule: "08:30 Asia/Shanghai"
    }
  };
}

export function getReports(query, origin) {
  let sql = "SELECT * FROM reports WHERE 1=1";
  const params = [];
  if (origin && origin !== "all") { sql += " AND origin=?"; params.push(origin); }
  if (query) { sql += " AND (title LIKE ? OR topic LIKE ? OR summary LIKE ? OR tags LIKE ?)"; const q = `%${query}%`; params.push(q, q, q, q); }
  sql += " ORDER BY created_at DESC LIMIT 200";
  return db.prepare(sql).all(...params).map(formatReport);
}

export function getReport(id) {
  const row = db.prepare("SELECT * FROM reports WHERE id=?").get(id);
  return row ? formatReport(row) : null;
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
  db.prepare("UPDATE reports SET archived=1, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getReport(id);
}

export function insertReport(report) {
  db.prepare(`INSERT OR REPLACE INTO reports (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    report.id, report.title, report.topic, report.type, report.typeLabel, report.summary,
    JSON.stringify(report.tags||[]), report.status||"new", 0, 0, report.source, report.origin,
    report.originLabel, report.localDate, report.file, report.wikiPath, report.accent,
    JSON.stringify(report.highlights||[]), report.createdAt, report.updatedAt||report.createdAt
  );
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

function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
}

function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.weekday} · ${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
}
