import db from "../services/db.js";
import { appendLog } from "../services/logs.js";
import { getStockQuote, searchStocks } from "../services/market-data.js";

export async function getBatchQuotes(items = []) {
  const limited = Array.isArray(items) ? items.slice(0, 80) : [];
  const pairs = await Promise.all(limited.map(async (item) => {
    const code = String(item.code || "").trim();
    if (!code) return null;
    const quote = await resolveQuoteForItem(item);
    return quote ? [code, quote] : null;
  }));
  return Object.fromEntries(pairs.filter(Boolean));
}

export function upsertQuoteOverride(body = {}) {
  const code = String(body.code || "").trim();
  const price = Number(body.price);
  if (!code) throw Object.assign(new Error("code required"), { statusCode: 400 });
  if (!Number.isFinite(price) || price <= 0) throw Object.assign(new Error("price must be positive"), { statusCode: 400 });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO quote_overrides (code,name,market,price,change_pct,source_label,note,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    code,
    String(body.name || "").trim(),
    String(body.market || "").trim(),
    price,
    body.changePct === undefined ? null : String(body.changePct).trim(),
    String(body.sourceLabel || "手动行情").trim(),
    String(body.note || "").trim(),
    now
  );
  const quote = getQuoteOverride(code);
  appendLog("quote_override", "Saved manual quote override: " + code, { code, price, sourceLabel: quote?.sourceLabel || "手动行情" });
  return quote;
}

export function deleteQuoteOverride(code) {
  const result = db.prepare("DELETE FROM quote_overrides WHERE code=?").run(code);
  if (result.changes > 0) appendLog("quote_override", "Deleted manual quote override: " + code, { code });
  return { deleted: result.changes > 0 };
}

export function getQuoteOverride(code) {
  const row = db.prepare("SELECT * FROM quote_overrides WHERE code=?").get(code);
  return row ? formatOverride(row) : null;
}

async function resolveQuoteForItem(item) {
  const code = String(item.code || "").trim();
  const quoteSecid = String(item.quoteSecid || item.quote_secid || "").trim();
  const direct = await getStockQuote(quoteSecid || code);
  if (direct) return direct;

  if (quoteSecid && quoteSecid !== code) {
    const byCode = await getStockQuote(code);
    if (byCode) return byCode;
  }

  const results = await searchStocks(code).catch(() => []);
  const match = results.find((result) => result.code === code) || results[0];
  return match?.secid ? getStockQuote(match.secid).catch(() => null) : null;
}

function formatOverride(row) {
  const price = Number(row.price);
  return {
    name: row.name || row.code,
    price,
    market: row.market || "手动",
    high: price,
    low: price,
    open: price,
    changePct: row.change_pct || "0.00",
    source: "manual",
    sourceLabel: row.source_label || "手动行情",
    note: row.note || "",
    updatedAt: row.updated_at
  };
}
