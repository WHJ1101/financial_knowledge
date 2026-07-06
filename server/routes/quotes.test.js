import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-quotes-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("../services/db.js");
const { getStockQuote } = await import("../services/market-data.js");
const { getBatchQuotes, upsertQuoteOverride, deleteQuoteOverride } = await import("./quotes.js");

test("manual quote override is used when live quote is unavailable", async () => {
  upsertQuoteOverride({ code: "manual-only", name: "手动标的", market: "基金", price: 1.234, changePct: "0.56" });

  const quote = await getStockQuote("manual-only");
  assert.equal(quote.price, 1.234);
  assert.equal(quote.source, "manual");
  assert.equal(quote.sourceLabel, "手动行情");
});

test("batch quotes returns override quotes by code", async () => {
  upsertQuoteOverride({ code: "batch-only", name: "批量标的", price: 2.5 });

  const quotes = await getBatchQuotes([{ code: "batch-only" }]);
  assert.equal(quotes["batch-only"].price, 2.5);
});

test("manual quote override can be deleted", () => {
  upsertQuoteOverride({ code: "delete-override", price: 3 });

  assert.deepEqual(deleteQuoteOverride("delete-override"), { deleted: true });
  assert.deepEqual(deleteQuoteOverride("delete-override"), { deleted: false });
});

test("manual quote override writes compact audit logs", () => {
  upsertQuoteOverride({ code: "audit-override", price: 4.5 });
  deleteQuoteOverride("audit-override");

  const logs = db.prepare("SELECT type, meta FROM logs WHERE type=? AND meta LIKE ? ORDER BY created_at DESC LIMIT 2").all("quote_override", "%audit-override%");
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0].meta).code, "audit-override");
  assert.equal(JSON.parse(logs[1].meta).code, "audit-override");
});
