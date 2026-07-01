import db from "../services/db.js";
import { analyzeStock, analyzePosition } from "../services/stock-analyzer.js";

export function getStocks() {
  return db.prepare("SELECT * FROM stocks ORDER BY updated_at DESC").all().map(formatStock);
}

export function upsertStock(body) {
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  if (!code || !name) throw Object.assign(new Error("股票代码和名称必填"), { statusCode: 400 });
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO stocks (code,name,market,status,thesis,advice,risk,watch_signals,sparkline,analysis_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    code, name, body.market || "A股", body.status || "观察",
    body.thesis || "", body.advice || "", body.risk || "",
    JSON.stringify(normalizeList(body.watchSignals || "")),
    JSON.stringify(body.sparkline || []), "analyzing", now
  );
  analyzeStock(code, name, body.market || "A股");
  return db.prepare("SELECT * FROM stocks WHERE code=?").get(code);
}

export function deleteStock(code) {
  const changes = db.prepare("DELETE FROM stocks WHERE code=?").run(code).changes;
  return { deleted: changes > 0 };
}

export function getPositions() {
  return db.prepare("SELECT * FROM positions ORDER BY updated_at DESC").all().map(formatPosition);
}

export function upsertPosition(body) {
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  const quoteSecid = String(body.quoteSecid || body.quote_secid || "").trim();
  if (!code || !name) throw Object.assign(new Error("持仓代码和名称必填"), { statusCode: 400 });
  const id = body.id || `${code}-${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO positions (id,code,name,market,quote_secid,shares,cost,reason,risk,analysis_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, code, name, body.market || "A股", quoteSecid,
    Number(body.shares) || 0, Number(body.cost) || 0,
    body.reason || "", body.risk || "", "analyzing", now
  );
  analyzePosition(id, code, name, body.market || "A股");
  return db.prepare("SELECT * FROM positions WHERE id=?").get(id);
}

export function updatePosition(id, body) {
  const row = db.prepare("SELECT * FROM positions WHERE id=?").get(id);
  if (!row) throw Object.assign(new Error("Position not found"), { statusCode: 404 });
  const shares = Number(body.shares);
  const cost = Number(body.cost);
  if (!Number.isFinite(shares) || shares < 0) throw Object.assign(new Error("持仓数量不合法"), { statusCode: 400 });
  if (!Number.isFinite(cost) || cost < 0) throw Object.assign(new Error("成本价不合法"), { statusCode: 400 });
  const now = new Date().toISOString();
  db.prepare("UPDATE positions SET shares=?, cost=?, analysis_status='analyzing', updated_at=? WHERE id=?").run(shares, cost, now, id);
  analyzePosition(row.id, row.code, row.name, row.market);
  return db.prepare("SELECT * FROM positions WHERE id=?").get(id);
}

export function deletePosition(id) {
  const changes = db.prepare("DELETE FROM positions WHERE id=?").run(id).changes;
  return { deleted: changes > 0 };
}

export function reanalyzeStock(code) {
  const row = db.prepare("SELECT * FROM stocks WHERE code=?").get(code);
  if (!row) throw Object.assign(new Error("Stock not found"), { statusCode: 404 });
  analyzeStock(row.code, row.name, row.market);
  return { status: "analyzing" };
}

export function reanalyzePosition(id) {
  const row = db.prepare("SELECT * FROM positions WHERE id=?").get(id);
  if (!row) throw Object.assign(new Error("Position not found"), { statusCode: 404 });
  analyzePosition(row.id, row.code, row.name, row.market);
  return { status: "analyzing" };
}

function formatStock(row) {
  return { ...row, watchSignals: JSON.parse(row.watch_signals || "[]"), sparkline: JSON.parse(row.sparkline || "[]"), analysisStatus: row.analysis_status || "pending", updatedAt: row.updated_at };
}

function formatPosition(row) {
  return { ...row, quoteSecid: row.quote_secid || "", analysisStatus: row.analysis_status || "pending", updatedAt: row.updated_at };
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  return String(value).split(/[，,、\n]/).map(s => s.trim()).filter(Boolean);
}
