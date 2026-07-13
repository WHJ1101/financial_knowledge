import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "portfolio-history-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;
// 失败路径无需真实退避，压到 1 次尝试避免拖慢测试。
process.env.PRESSURE_KLINE_MAX_ATTEMPTS = "1";
process.env.PRESSURE_KLINE_RETRY_MS = "0";
process.env.FUND_NAV_MAX_ATTEMPTS = "1";
process.env.FUND_NAV_RETRY_MS = "0";

const { default: db } = await import("./db.js");
const {
  classifyBarSecid,
  exchangeSecidFromCode,
  resolveBarSecid,
  syncPortfolioBars,
  saveSecidMap,
  getPortfolioHistorySyncStatus,
} = await import("./portfolio-history.js");
const { getAllBars } = await import("./kline-store.js");

const noMap = () => null; // 不查 secid_map，测纯规则

// P1-3 exchangeSecidFromCode
test("P1-3 exchangeSecidFromCode maps by code segment", () => {
  assert.equal(exchangeSecidFromCode("159995"), "0.159995"); // 15x → 深
  assert.equal(exchangeSecidFromCode("588170"), "1.588170"); // 5xx → 沪
  assert.equal(exchangeSecidFromCode("510880"), "1.510880");
  assert.equal(exchangeSecidFromCode("000300"), "0.000300");
  assert.equal(exchangeSecidFromCode("abc"), null);
});

// P1-2 归一化：基金分支最先短路
test("P1-2 fund branch short-circuits first (150. prefix)", () => {
  assert.deepEqual(resolveBarSecid({ code: "014662", quoteSecid: "150.014662", market: "基金" }, { lookupMapped: noMap }),
    { secid: "OF.014662", kind: "fund", fetchCode: "014662", currency: "CNY" });
});

test("P1-2 empty-secid fund by market (main path)", () => {
  const r = resolveBarSecid({ code: "025208", quoteSecid: "", market: "基金" }, { lookupMapped: noMap });
  assert.equal(r.secid, "OF.025208");
  assert.equal(r.kind, "fund");
});

test("P1-2 LOF same-code 163806 must NOT become 0.163806 exchange", () => {
  const r = resolveBarSecid({ code: "163806", quoteSecid: "", market: "基金" }, { lookupMapped: noMap });
  assert.equal(r.secid, "OF.163806", "LOF 同码必须归 OF. 而非场内 0.163806");
  assert.equal(r.kind, "fund");
});

test("P1-2 existing exchange secid kept as-is", () => {
  const r = resolveBarSecid({ code: "588170", quoteSecid: "1.588170", market: "ETF" }, { lookupMapped: noMap });
  assert.deepEqual(r, { secid: "1.588170", kind: "exchange", fetchCode: "1.588170", currency: "CNY" });
});

test("P1-2 empty-secid ETF by code segment", () => {
  const r = resolveBarSecid({ code: "159995", quoteSecid: "", market: "ETF" }, { lookupMapped: noMap });
  assert.equal(r.secid, "0.159995");
  assert.equal(r.kind, "exchange");
});

test("P1-2 HK/US and unknown → skipped (null)", () => {
  assert.equal(resolveBarSecid({ code: "700", market: "港股" }, { lookupMapped: noMap }), null);
  assert.equal(resolveBarSecid({ code: "AAPL", quoteSecid: "105.AAPL", market: "美股" }, { lookupMapped: noMap }), null);
  assert.equal(resolveBarSecid({ code: "", market: "" }, { lookupMapped: noMap }), null);
});

// secid_map 命中优先于纯规则（001557 被持久化为 OF. 后，即使 market 标错也读 OF.）
test("resolveBarSecid prefers persisted secid_map over rule", () => {
  const mapped = { code: "001557", secid: "OF.001557", kind: "fund" };
  const r = resolveBarSecid({ code: "001557", quoteSecid: "", market: "深市主板" }, { lookupMapped: () => mapped });
  assert.equal(r.secid, "OF.001557");
  assert.equal(r.kind, "fund");
});

// P1-4 + 探测回退：001557 market 标"深市主板"但实为基金，交易所无数据 → 回退基金接口 → 落 OF. + secid_map
test("P1-4 syncPortfolioBars: exchange miss falls back to fund, persists secid_map", async () => {
  // 造持仓：001557(market标错) + 588170(真ETF)
  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO positions (id,code,name,market,quote_secid,shares,cost,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("p1", "001557", "天弘中证500增强C", "深市主板", "", 100, 1, now);
  db.prepare("INSERT OR REPLACE INTO positions (id,code,name,market,quote_secid,shares,cost,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("p2", "588170", "科创半导体ETF", "ETF", "1.588170", 200, 1, now);

  const fetchImpl = async (url) => {
    const u = String(url);
    // 交易所接口：001557 无数据(data.klines 空)；588170 有数据
    if (u.includes("push2his")) {
      if (u.includes("secid=1.588170")) {
        return new Response(JSON.stringify({ data: { klines: ["2026-07-01,1.1,100", "2026-07-02,1.2,120"] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: null }), { status: 200 }); // 001557 交易所无数据
    }
    // 基金接口：001557 有净值（回退命中）
    if (u.includes("pingzhongdata/001557")) {
      const ts = (d) => Date.parse(`${d}T00:00:00Z`);
      return new Response(`var Data_netWorthTrend=[{"x":${ts("2026-07-01")},"y":1.8,"equityReturn":0},{"x":${ts("2026-07-02")},"y":1.84,"equityReturn":2}]; var Data_ACWorthTrend=[[${ts("2026-07-01")},1.8],[${ts("2026-07-02")},1.84]];`, { status: 200 });
    }
    throw new Error(`unexpected ${u}`);
  };

  const results = await syncPortfolioBars({ fetchImpl });
  const r1557 = results.find((r) => r.code === "001557");
  assert.equal(r1557.ok, true);
  assert.equal(r1557.secid, "OF.001557", "market 标错的基金经回退落到 OF.");
  assert.equal(r1557.kind, "fund");
  // 落库确认
  assert.equal(getAllBars("OF.001557").length, 2);
  assert.equal(getAllBars("1.588170").length, 2);
  // secid_map 持久化
  const mapped = db.prepare("SELECT secid,kind FROM secid_map WHERE code='001557'").get();
  assert.equal(mapped.secid, "OF.001557");
  assert.equal(mapped.kind, "fund");
  // 快照落 settings
  const status = getPortfolioHistorySyncStatus();
  assert.equal(status.succeeded, 2);
  assert.equal(status.failed, 0);
});

// P1-4 单标的失败不影响其余
test("P1-4 single failure isolated", async () => {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM positions").run();
  db.prepare("DELETE FROM secid_map").run();
  db.prepare("INSERT INTO positions (id,code,name,market,quote_secid,shares,cost,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("q1", "159995", "芯片ETF", "ETF", "0.159995", 100, 1, now);
  db.prepare("INSERT INTO positions (id,code,name,market,quote_secid,shares,cost,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("q2", "588080", "科创芯片ETF", "ETF", "1.588080", 100, 1, now);

  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes("secid=0.159995")) throw new Error("network down");
    if (u.includes("secid=1.588080")) return new Response(JSON.stringify({ data: { klines: ["2026-07-01,1,100"] } }), { status: 200 });
    return new Response(JSON.stringify({ data: null }), { status: 200 });
  };
  const results = await syncPortfolioBars({ fetchImpl });
  assert.equal(results.find((r) => r.code === "159995").ok, false);
  assert.equal(results.find((r) => r.code === "588080").ok, true);
});
