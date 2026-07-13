import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "kline-store-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;
process.env.PRESSURE_KLINE_MAX_ATTEMPTS = "1";
process.env.PRESSURE_KLINE_RETRY_MS = "0";

const { syncDailyBars, getBars, getAllBars, fetchHistoricalExchangeBars, upsertBars } = await import("./kline-store.js");

// 造一个东财 kline 响应体（date,close,volume）。
function eastmoneyResponse(rows) {
  const klines = rows.map((r) => `${r.date},${r.close},${r.volume}`);
  return new Response(JSON.stringify({ data: { klines } }), { status: 200 });
}

// syncDailyBars 并发抓取：单标的失败不影响其余，结果顺序与入参一致，成功的落库。
test("syncDailyBars fetches concurrently, isolates failures, preserves order", async () => {
  const secids = ["1.000001", "1.000002", "1.000003"];
  const started = [];
  let resolveGate;
  const gate = new Promise((r) => { resolveGate = r; });

  const fetchImpl = async (url) => {
    started.push(url);
    // 第一个 secid 故意阻塞，直到后两个都已发起 —— 证明是并发而非串行。
    if (url.includes("1.000001")) {
      await gate;
      throw new Error("boom"); // 该标的失败
    }
    if (started.length >= 3) resolveGate();
    const code = url.match(/secid=([^&]+)/)[1];
    return eastmoneyResponse([{ date: "2026-07-01", close: 10, volume: 100 }, { date: "2026-07-02", close: 11, volume: 120 }]);
  };

  const results = await syncDailyBars(secids, { fetchImpl });

  // 三个请求几乎同时发起（并发），而非等第一个完成
  assert.equal(started.length, 3, "所有 secid 的抓取都已发起（并发）");
  // 结果顺序与入参顺序一致
  assert.deepEqual(results.map((r) => r.secid), secids, "结果顺序与入参一致");
  // 第一个失败被隔离，其余成功
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /boom/);
  assert.equal(results[1].ok, true);
  assert.equal(results[1].count, 2);
  assert.equal(results[2].ok, true);
  // 成功的确实落库了
  assert.equal(getBars("1.000002").length, 2);
  assert.equal(getBars("1.000001").length, 0, "失败的未落库");
});

// 空数组不抛、返回空。
test("syncDailyBars handles empty input", async () => {
  const results = await syncDailyBars([], { fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(results, []);
});

// upsertBars now 省略时不写 null updated_at；volume 缺失落 null。
test("upsertBars defaults now, tolerates missing volume, getAllBars ascending", () => {
  upsertBars("T.NOW", [{ date: "2026-07-02", close: 2 }, { date: "2026-07-01", close: 1, volume: 5 }]);
  const all = getAllBars("T.NOW");
  assert.deepEqual(all.map((b) => b.date), ["2026-07-01", "2026-07-02"]); // 升序
  assert.equal(all[1].volume, null); // 缺 volume → null
});

// fetchHistoricalExchangeBars：fqt=1、跨分页向前翻、按日期去重升序、close>0 过滤。
test("fetchHistoricalExchangeBars paginates backward, dedups, filters, uses fqt=1", async () => {
  const CHUNK = 3;
  const urls = [];
  // 造两页：第一页最新 3 天(07-05..07-03)，第二页更早 3 天(07-02..06-30)含与第一页无重叠。
  const pages = {
    "20500101": ["2026-07-03,3,300", "2026-07-04,4,400", "2026-07-05,5,500"],           // 升序返回，最早在前
    "20260702": ["2026-06-30,0,0", "2026-07-01,1,100", "2026-07-02,2,200"],              // 含一个 close=0 应被过滤
  };
  const fetchImpl = async (url) => {
    urls.push(url);
    assert.match(url, /fqt=1/, "必须前复权 fqt=1");
    const end = url.match(/end=(\d+)/)[1];
    const klines = pages[end] || [];
    return new Response(JSON.stringify({ data: { klines } }), { status: 200 });
  };
  const { bars, truncated, requests } = await fetchHistoricalExchangeBars("1.588170", { fetchImpl, chunkSize: CHUNK });
  assert.equal(requests, 3, "两页各满 3 条→需第 3 次探测返回空才确认到底");
  // close=0 的 06-30 被过滤，其余升序去重
  assert.deepEqual(bars.map((b) => b.date), ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);
  assert.ok(bars.every((b) => b.close > 0));
  assert.equal(truncated, false);
});

// 一次拉全（返回不足分页大小即停）。
test("fetchHistoricalExchangeBars stops when page under chunkSize", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: { klines: ["2026-07-01,1,100", "2026-07-02,2,200"] } }), { status: 200 });
  };
  const { bars, requests } = await fetchHistoricalExchangeBars("1.000001", { fetchImpl, chunkSize: 2000 });
  assert.equal(requests, 1, "首页 2 条 < 2000 → 一次拉全");
  assert.equal(calls, 1);
  assert.equal(bars.length, 2);
});
