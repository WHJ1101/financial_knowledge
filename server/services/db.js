import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FINANCE_KNOWLEDGE_DATA_DIR || join(__dirname, "../../data");
const DB_PATH = join(DATA_DIR, "app.db");
const MIGRATION_MARKER = join(DATA_DIR, ".better-sqlite3-migrated");

mkdirSync(DATA_DIR, { recursive: true });
const migrationBackupPath = backupExistingDatabaseOnce();

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const DDL = [
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', type_label TEXT, summary TEXT, tags TEXT DEFAULT '[]', status TEXT DEFAULT 'new', starred INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', origin TEXT DEFAULT 'manual', origin_label TEXT, local_date TEXT, file TEXT, wiki_path TEXT, accent TEXT, highlights TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stocks (code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT DEFAULT 'A股', status TEXT DEFAULT '观察', thesis TEXT, advice TEXT, risk TEXT, watch_signals TEXT DEFAULT '[]', sparkline TEXT DEFAULT '[]', updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, market TEXT DEFAULT 'A股', quote_secid TEXT, shares REAL DEFAULT 0, cost REAL DEFAULT 0, reason TEXT, risk TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS market_indices (code TEXT PRIMARY KEY, region TEXT NOT NULL, name TEXT NOT NULL, level TEXT, change_pct TEXT, volume TEXT, related_etfs TEXT DEFAULT '[]', updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS automation_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER DEFAULT 0, goal TEXT, implementation TEXT, prompt TEXT, schedule TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS community_signals (id TEXT PRIMARY KEY, date TEXT NOT NULL, source TEXT NOT NULL, source_title TEXT, source_url TEXT, theme TEXT, industry TEXT, related_assets TEXT DEFAULT '[]', signal_type TEXT, summary TEXT, evidence TEXT, confidence TEXT DEFAULT 'medium', verification_status TEXT DEFAULT '待验证', importance INTEGER DEFAULT 3, observed_at TEXT, imported_at TEXT, expires_at TEXT, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, date TEXT, title TEXT NOT NULL, summary TEXT, action TEXT, market TEXT, position_advice TEXT DEFAULT '[]', stock_advice TEXT DEFAULT '[]', reports TEXT DEFAULT '[]', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, type TEXT, message TEXT, meta TEXT DEFAULT '{}', created_at TEXT, local_time TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS quote_overrides (code TEXT PRIMARY KEY, name TEXT, market TEXT, price REAL NOT NULL, change_pct TEXT, source_label TEXT DEFAULT '手动行情', note TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS report_asset_links (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, asset_code TEXT NOT NULL, asset_name TEXT, asset_market TEXT, relation TEXT DEFAULT 'related', source TEXT DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS daily_bars (secid TEXT NOT NULL, date TEXT NOT NULL, close REAL, volume REAL, updated_at TEXT, PRIMARY KEY (secid, date))`,
  `CREATE INDEX IF NOT EXISTS idx_reports_local_date ON reports(local_date)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_starred ON reports(starred)`,
  `CREATE INDEX IF NOT EXISTS idx_signals_date ON community_signals(date)`,
  `CREATE INDEX IF NOT EXISTS idx_signals_importance ON community_signals(importance)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_report_asset_links_report ON report_asset_links(report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_asset_links_asset ON report_asset_links(asset_code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_report_asset_links_unique ON report_asset_links(report_id, asset_code, relation, source)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_bars_secid_date ON daily_bars(secid, date)`
];

for (const stmt of DDL) db.exec(stmt);
if (migrationBackupPath) appendStorageMigrationLog(migrationBackupPath);

for (const alter of [
  "ALTER TABLE stocks ADD COLUMN analysis_status TEXT DEFAULT 'pending'",
  "ALTER TABLE positions ADD COLUMN analysis_status TEXT DEFAULT 'pending'",
  "ALTER TABLE positions ADD COLUMN quote_secid TEXT"
]) {
  try { db.exec(alter); } catch {}
}

const dbWrapper = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      run(...params) {
        return stmt.run(...normalizeParams(params));
      },
      get(...params) {
        return stmt.get(...normalizeParams(params));
      },
      all(...params) {
        return stmt.all(...normalizeParams(params));
      }
    };
  },
  exec(sql) {
    return db.exec(sql);
  },
  transaction(fn) {
    const tx = db.transaction(fn);
    return (...args) => tx(...args);
  }
};

function normalizeParams(params) {
  return params.map(normalizeParam);
}

function normalizeParam(value) {
  // Load-bearing compatibility with the old sql.js wrapper. better-sqlite3 rejects
  // undefined and booleans, while callers historically relied on this coercion.
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function backupExistingDatabaseOnce() {
  if (!existsSync(DB_PATH) || existsSync(MIGRATION_MARKER)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(DATA_DIR, `app.db.pre-better-sqlite3-${stamp}.bak`);
  copyFileSync(DB_PATH, backupPath);
  writeFileSync(MIGRATION_MARKER, new Date().toISOString(), "utf8");
  return backupPath;
}

function appendStorageMigrationLog(backupPath) {
  db.prepare("INSERT INTO logs (id,type,message,meta,created_at,local_time) VALUES (?,?,?,?,?,?)").run(
    Date.now() + "-" + Math.random().toString(16).slice(2),
    "storage_migration",
    "Created better-sqlite3 migration backup",
    JSON.stringify({ backupPath }),
    new Date().toISOString(),
    null
  );
}

export default dbWrapper;
export { DATA_DIR, DB_PATH };
