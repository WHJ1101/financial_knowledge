import assert from "node:assert/strict";
import test from "node:test";

import { derivePositionNumbers, normalizePositionPayload, positionQuoteKey, toPositiveNumber } from "./position-math.js";

test("detail entry: shares + cost used directly", () => {
  const r = derivePositionNumbers({ shares: "100", cost: "12.5" }, null);
  assert.deepEqual(r, { shares: 100, cost: 12.5, source: "detail" });
});

test("amount + marketValue + price estimates shares and cost", () => {
  const r = derivePositionNumbers({ amount: "10000", marketValue: "11000" }, { price: 11 });
  assert.equal(r.source, "amount-market");
  assert.equal(r.shares, 1000);
  assert.equal(r.cost, 10); // 10000 / 1000
});

test("amount + marketValue without price is blocked", () => {
  const r = derivePositionNumbers({ amount: "10000", marketValue: "11000" }, null);
  assert.equal(r.blocked, true);
  assert.equal(r.shares, 0);
});

test("shares + amount derives cost", () => {
  const r = derivePositionNumbers({ shares: "200", amount: "4000" }, null);
  assert.equal(r.shares, 200);
  assert.equal(r.cost, 20);
});

test("shares only keeps cost unknown", () => {
  const r = derivePositionNumbers({ shares: "50" }, null);
  assert.deepEqual(r, { shares: 50, cost: 0, source: "shares-only" });
});

test("empty form yields empty source", () => {
  assert.equal(derivePositionNumbers({}, null).source, "empty");
});

test("toPositiveNumber rejects zero, negatives and NaN", () => {
  assert.equal(toPositiveNumber("0"), 0);
  assert.equal(toPositiveNumber("-5"), 0);
  assert.equal(toPositiveNumber("abc"), 0);
  assert.equal(toPositiveNumber("3.5"), 3.5);
});

test("normalizePositionPayload falls back name to code", () => {
  const payload = normalizePositionPayload({ code: "600000", market: "A股", shares: "100", cost: "10" }, null);
  assert.equal(payload.name, "600000");
  assert.equal(payload.shares, 100);
  assert.equal(payload.cost, 10);
});

test("positionQuoteKey prefers explicit secid, then OTC fund code", () => {
  assert.equal(positionQuoteKey({ quoteSecid: "1.600000" }), "1.600000");
  assert.equal(positionQuoteKey({ code: "160123", market: "基金" }), "160123");
  assert.equal(positionQuoteKey({ code: "600000", market: "A股" }), "");
});
