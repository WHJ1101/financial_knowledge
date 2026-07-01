import db from "../services/db.js";

export function getSignals(params = {}) {
  const limit = Math.max(1, Math.min(200, Number(params.limit || 100)));
  const clauses = [];
  const values = [];

  if (params.date) {
    clauses.push("date=?");
    values.push(params.date);
  }
  if (params.status && params.status !== "all") {
    clauses.push("verification_status=?");
    values.push(params.status);
  }
  if (params.source && params.source !== "all") {
    clauses.push("source=?");
    values.push(params.source);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT * FROM community_signals
    ${where}
    ORDER BY date DESC, importance DESC, imported_at DESC
    LIMIT ${limit}
  `).all(...values).map(formatSignal);
}

export function getTopCommunitySignals({ limit = 5, now = new Date() } = {}) {
  const capped = Math.max(1, Math.min(20, Number(limit || 5)));
  return db.prepare(`
    SELECT * FROM community_signals
    WHERE verification_status != '已证伪'
      AND (expires_at IS NULL OR expires_at = '' OR expires_at >= ?)
    ORDER BY importance DESC, date DESC, imported_at DESC
    LIMIT ${capped}
  `).all(now.toISOString()).map(formatSignal);
}

export function upsertCommunitySignals(signals = []) {
  const now = new Date().toISOString();
  let changed = 0;

  for (const signal of signals) {
    if (!signal?.id || !signal.summary) continue;
    const existing = db.prepare("SELECT created_at FROM community_signals WHERE id=?").get(signal.id);
    db.prepare(`
      INSERT OR REPLACE INTO community_signals (
        id,date,source,source_title,source_url,theme,industry,related_assets,signal_type,summary,evidence,
        confidence,verification_status,importance,observed_at,imported_at,expires_at,metadata,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      signal.id,
      signal.date,
      signal.source,
      signal.sourceTitle || signal.source_title || "",
      signal.sourceUrl || signal.source_url || "",
      signal.theme || "",
      signal.industry || "",
      JSON.stringify(signal.relatedAssets || signal.related_assets || []),
      signal.signalType || signal.signal_type || "",
      signal.summary || "",
      signal.evidence || "",
      signal.confidence || "medium",
      signal.verificationStatus || signal.verification_status || "待验证",
      Number(signal.importance || 3),
      signal.observedAt || signal.observed_at || signal.importedAt || "",
      signal.importedAt || signal.imported_at || now,
      signal.expiresAt || signal.expires_at || "",
      JSON.stringify(signal.metadata || {}),
      existing?.created_at || now,
      now
    );
    changed += 1;
  }

  return { changed };
}

export function replaceCommunitySignalSnapshot(signals = []) {
  const first = signals[0];
  if (!first) return { changed: 0, replaced: 0 };

  const source = first.source || "";
  const date = first.date || "";
  const sourceTitle = first.sourceTitle || first.source_title || "";
  const deleted = db.prepare("DELETE FROM community_signals WHERE source=? AND date=? AND source_title=?").run(source, date, sourceTitle).changes || 0;
  const inserted = upsertCommunitySignals(signals).changed;
  return { changed: inserted, replaced: deleted };
}

function formatSignal(row) {
  return {
    id: row.id,
    date: row.date,
    source: row.source,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    theme: row.theme,
    industry: row.industry,
    relatedAssets: parseJson(row.related_assets, []),
    signalType: row.signal_type,
    summary: row.summary,
    evidence: row.evidence,
    confidence: row.confidence,
    verificationStatus: row.verification_status,
    importance: Number(row.importance || 0),
    observedAt: row.observed_at,
    importedAt: row.imported_at,
    expiresAt: row.expires_at,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}
