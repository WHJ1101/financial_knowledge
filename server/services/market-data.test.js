import assert from "node:assert/strict";
import test from "node:test";

import { getStockQuote, parseEastmoneyFundPage, parseTiantianFundJsonp } from "./market-data.js";

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
