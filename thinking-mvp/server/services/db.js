import initSqlJs from "sql.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const DB_PATH = join(DATA_DIR, "app.db");

mkdirSync(DATA_DIR, { recursive: true });

const SQL = await initSqlJs();
let db;
if (existsSync(DB_PATH)) {
  db = new SQL.Database(readFileSync(DB_PATH));
} else {
  db = new SQL.Database();
}

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

const DDL = [
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'custom', type_label TEXT, summary TEXT, tags TEXT DEFAULT '[]', status TEXT DEFAULT 'new', starred INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', origin TEXT DEFAULT 'manual', origin_label TEXT, local_date TEXT, file TEXT, wiki_path TEXT, accent TEXT, highlights TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stocks (code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT DEFAULT 'A股', status TEXT DEFAULT '观察', thesis TEXT, advice TEXT, risk TEXT, watch_signals TEXT DEFAULT '[]', sparkline TEXT DEFAULT '[]', updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, market TEXT DEFAULT 'A股', shares REAL DEFAULT 0, cost REAL DEFAULT 0, reason TEXT, risk TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS market_indices (code TEXT PRIMARY KEY, region TEXT NOT NULL, name TEXT NOT NULL, level TEXT, change_pct TEXT, volume TEXT, related_etfs TEXT DEFAULT '[]', updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS automation_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER DEFAULT 0, goal TEXT, implementation TEXT, prompt TEXT, schedule TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, date TEXT, title TEXT NOT NULL, summary TEXT, action TEXT, market TEXT, position_advice TEXT DEFAULT '[]', stock_advice TEXT DEFAULT '[]', reports TEXT DEFAULT '[]', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, type TEXT, message TEXT, meta TEXT DEFAULT '{}', created_at TEXT, local_time TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_local_date ON reports(local_date)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_starred ON reports(starred)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)`
];
for (const stmt of DDL) db.run(stmt);;

// Safe ALTER TABLE (ignore if column already exists)
for (const alter of [
  "ALTER TABLE stocks ADD COLUMN analysis_status TEXT DEFAULT 'pending'",
  "ALTER TABLE positions ADD COLUMN analysis_status TEXT DEFAULT 'pending'"
]) { try { db.run(alter); } catch {} }

saveDb();

// Wrapper to provide better-sqlite3-like API
function saveDb() {
  writeFileSync(DB_PATH, Buffer.from(db.export()));
}

const dbWrapper = {
  prepare(sql) {
    return {
      run(...params) {
        db.run(sql, params.map(v => v === undefined ? null : v));
        saveDb();
        return { changes: db.getRowsModified() };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        if (params.length) stmt.bind(params.map(v => v === undefined ? null : v));
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        if (params.length) stmt.bind(params.map(v => v === undefined ? null : v));
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      }
    };
  },
  exec(sql) { db.exec(sql); saveDb(); },
  transaction(fn) {
    // sql.js doesn't support explicit transactions well with our wrapper
    // Just run the function directly - each run() already saves
    return (...args) => { fn(...args); };
  }
};

export default dbWrapper;
export { DATA_DIR, DB_PATH };
