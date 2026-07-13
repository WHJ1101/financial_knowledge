import assert from "node:assert/strict";
import test from "node:test";

import { getStockQuote, parseEastmoneyFundPage, parseTiantianFundJsonp, parseFundNavHistory, fetchFundNavHistory } from "./market-data.js";

test("empty Tiantian fund JSONP is ignored instead of throwing", () => {
  assert.equal(parseTiantianFundJsonp("jsonpgz();"), null);
});

test("parses Eastmoney fund net worth as fallback quote", () => {
  const quote = parseEastmoneyFundPage(`
    var fS_name = "测试基金";
    var Data_netWorthTrend = [{"x":1782835200000,"y":1.243,"equityReturn":0.10}];
    /*累计净值走势*/var Data_ACWorthTrend = [[1782835200000,1.243]];
  `, "007722");

  assert.equal(quote.name, "测试基金");
  assert.equal(quote.price, 1.243);
  assert.equal(quote.changePct, "0.10");
  assert.equal(quote.sourceLabel, "东方财富基金净值");
});

test("OTC fund quote falls back when Tiantian returns empty JSONP", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("fundgz.1234567.com.cn")) {
      return new Response("jsonpgz();", { status: 200 });
    }
    if (String(url).includes("fund.eastmoney.com/pingzhongdata/007722.js")) {
      return new Response(`
        var fS_name = "中银基金";
        var Data_netWorthTrend = [{"x":1782835200000,"y":1.243,"equityReturn":0.10}];
      `, { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const quote = await getStockQuote("150.007722");
    assert.equal(quote.price, 1.243);
    assert.equal(quote.sourceLabel, "东方财富基金净值");
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// —— parseFundNavHistory 前复权净值口径（§4.1 / P1-1）——
const TS = (ymd) => Date.parse(`${ymd}T00:00:00Z`); // 东财 x = UTC 00:00 = 北京当天

// P1-1 分红基金：单位净值分红日假暴跌，但前复权净值(累计净值锚定)不假暴跌、且末点≈最新单位净值不虚高。
test("P1-1 parseFundNavHistory rebuilds adjusted nav: no dividend fake-crash, tail not inflated", () => {
  // 模拟 163806：分红日单位净值 1.312→1.164(-11%)，累计净值 1.522→1.524(+0.13%)；末点单位净值 1.24/累计 1.93
  const text = `
    var Data_netWorthTrend = [
      {"x":${TS("2015-12-17")},"y":1.312,"equityReturn":0},
      {"x":${TS("2015-12-18")},"y":1.164,"equityReturn":-11.28},
      {"x":${TS("2026-07-09")},"y":1.24,"equityReturn":0.1}
    ];
    var Data_ACWorthTrend = [
      [${TS("2015-12-17")},1.522],
      [${TS("2015-12-18")},1.524],
      [${TS("2026-07-09")},1.93]
    ];
  `;
  const series = parseFundNavHistory(text);
  assert.equal(series.length, 3);
  assert.deepEqual(series.map((p) => p.date), ["2015-12-17", "2015-12-18", "2026-07-09"]);
  // 分红日：前复权净值涨跌率 = 累计净值涨跌率 ≈ +0.13%，绝不是 -11% 假暴跌
  const chg = (series[1].close - series[0].close) / series[0].close * 100;
  assert.ok(chg > 0 && chg < 1, `分红日应≈+0.13%，实际 ${chg.toFixed(2)}%`);
  // 末点 = 最新单位净值 1.24（不虚高到累计净值 1.93）
  assert.ok(Math.abs(series.at(-1).close - 1.24) < 1e-6, `末点应≈1.24，实际 ${series.at(-1).close}`);
});

// P1-1 无分红基金：累计净值=单位净值，factor=1，序列等于单位净值本身。
test("P1-1 parseFundNavHistory no-dividend fund: factor=1, equals unit nav", () => {
  const text = `
    var Data_netWorthTrend = [{"x":${TS("2026-07-08")},"y":1.5,"equityReturn":0},{"x":${TS("2026-07-09")},"y":1.6,"equityReturn":6.7}];
    var Data_ACWorthTrend = [[${TS("2026-07-08")},1.5],[${TS("2026-07-09")},1.6]];
  `;
  const series = parseFundNavHistory(text);
  assert.deepEqual(series.map((p) => p.close), [1.5, 1.6]);
});

// P1-1 降级：无 Data_ACWorthTrend 时用单位净值并标 navKind:"unit"。
test("P1-1 parseFundNavHistory degrades to unit nav when no ACWorthTrend", () => {
  const text = `var Data_netWorthTrend = [{"x":${TS("2026-07-08")},"y":2.0,"equityReturn":0},{"x":${TS("2026-07-09")},"y":2.1,"equityReturn":5}];`;
  const series = parseFundNavHistory(text);
  assert.equal(series.length, 2);
  assert.equal(series[0].navKind, "unit");
  assert.deepEqual(series.map((p) => p.close), [2.0, 2.1]);
});

// P1-1 同日去重 + 非正净值过滤 + 升序。
test("P1-1 parseFundNavHistory dedups same day, drops non-positive, sorts asc", () => {
  const text = `
    var Data_netWorthTrend = [{"x":${TS("2026-07-09")},"y":1.6,"equityReturn":0}];
    var Data_ACWorthTrend = [
      [${TS("2026-07-09")},1.6],
      [${TS("2026-07-08")},1.5],
      [${TS("2026-07-08")},1.55],
      [${TS("2026-07-07")},0]
    ];
  `;
  const series = parseFundNavHistory(text);
  assert.deepEqual(series.map((p) => p.date), ["2026-07-08", "2026-07-09"]); // 07-07 净值0被丢，07-08去重
});

// fetchFundNavHistory：无效 code 返回 []，不抛、不发请求。
test("fetchFundNavHistory returns [] for invalid code without fetching", async () => {
  const series = await fetchFundNavHistory("abc", { fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.deepEqual(series, []);
});

// fetchFundNavHistory：正常抓取解析。
test("fetchFundNavHistory fetches and parses", async () => {
  const fetchImpl = async () => new Response(
    `var Data_netWorthTrend = [{"x":${TS("2026-07-09")},"y":1.6,"equityReturn":0}]; var Data_ACWorthTrend = [[${TS("2026-07-09")},1.6]];`,
    { status: 200 }
  );
  const series = await fetchFundNavHistory("014662", { fetchImpl });
  assert.equal(series.length, 1);
  assert.equal(series[0].close, 1.6);
});
