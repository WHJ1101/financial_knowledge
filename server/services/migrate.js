import dbWrapper, { DATA_DIR } from "./db.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const db = dbWrapper;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch { return null; }
}

function migrate() {
  const hasData = db.prepare("SELECT COUNT(*) as c FROM reports").get().c > 0;
  if (hasData) { console.log("DB already has data, skipping migration."); return; }

  console.log("Migrating JSON data to SQLite...");

  // Reports
  const reportsIndex = readJson(join(DATA_DIR, "reports.json"));
  if (reportsIndex?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO reports (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const tx = db.transaction((reports) => {
      for (const r of reports) {
        stmt.run(r.id, r.title, r.topic, r.type, r.typeLabel, r.summary, JSON.stringify(r.tags||[]), r.status||"new", 0, 0, r.source, r.origin, r.originLabel, r.localDate, r.file, r.wikiPath, r.accent, JSON.stringify(r.highlights||[]), r.createdAt, r.updatedAt||r.createdAt);
      }
    });
    tx(reportsIndex);
    console.log(`  Migrated ${reportsIndex.length} reports`);
  }

  // Stocks
  const stocks = readJson(join(DATA_DIR, "stocks.json"));
  if (stocks?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO stocks (code,name,market,status,thesis,advice,risk,watch_signals,sparkline,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const s of stocks) stmt.run(s.code, s.name, s.market, s.status, s.thesis, s.advice, s.risk, JSON.stringify(s.watchSignals||[]), JSON.stringify(s.sparkline||[]), s.updatedAt);
    console.log(`  Migrated ${stocks.length} stocks`);
  }

  // Positions
  const positions = readJson(join(DATA_DIR, "positions.json"));
  if (positions?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO positions (id,code,name,market,shares,cost,reason,risk,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const p of positions) stmt.run(p.id, p.code, p.name, p.market, p.shares, p.cost, p.reason, p.risk, p.updatedAt);
    console.log(`  Migrated ${positions.length} positions`);
  }

  // Market indices
  const indices = readJson(join(DATA_DIR, "market-indices.json"));
  if (indices?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO market_indices (code,region,name,level,change_pct,volume,related_etfs,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const i of indices) stmt.run(i.code, i.region, i.name, i.level, i.change, null, JSON.stringify(i.relatedEtfs||[]), null);
    console.log(`  Migrated ${indices.length} indices`);
  }

  // Automation tasks
  const tasks = readJson(join(DATA_DIR, "automation-tasks.json"));
  if (tasks?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO automation_tasks (id,name,enabled,goal,implementation,prompt,schedule,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const t of tasks) stmt.run(t.id, t.name, t.enabled?1:0, t.goal, t.implementation, t.prompt, t.schedule, t.createdAt, t.updatedAt);
    console.log(`  Migrated ${tasks.length} tasks`);
  }

  // Decisions
  const decisions = readJson(join(DATA_DIR, "decisions.json"));
  if (decisions?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO decisions (id,date,title,summary,action,market,position_advice,stock_advice,reports,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const d of decisions) stmt.run(d.id, d.date, d.title, d.summary, d.action, d.market, JSON.stringify(d.positionAdvice||[]), JSON.stringify(d.stockAdvice||[]), JSON.stringify(d.reports||[]), d.createdAt);
    console.log(`  Migrated ${decisions.length} decisions`);
  }

  // Settings
  const settings = readJson(join(DATA_DIR, "settings.json"));
  if (settings) {
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`);
    for (const [k, v] of Object.entries(settings)) stmt.run(k, JSON.stringify(v));
    console.log("  Migrated settings");
  }

  // Logs
  const logs = readJson(join(DATA_DIR, "logs.json"));
  if (logs?.length) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO logs (id,type,message,meta,created_at,local_time) VALUES (?,?,?,?,?,?)`);
    for (const l of logs) stmt.run(l.id, l.type, l.message, JSON.stringify(l.meta||{}), l.createdAt, l.localTime);
    console.log(`  Migrated ${logs.length} logs`);
  }

  console.log("Migration complete.");
}

migrate();
