import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsWindow, runDailyMarketBriefingPipeline } from "./dailyMarketBriefingPipeline.js";

test("daily briefing news window is fixed to execution time minus 24 hours", () => {
  const now = new Date("2026-06-30T00:30:00.000Z");
  const window = buildNewsWindow(now);

  assert.equal(window.end.toISOString(), "2026-06-30T00:30:00.000Z");
  assert.equal(window.start.toISOString(), "2026-06-29T00:30:00.000Z");
  assert.equal(window.end.getTime() - window.start.getTime(), 24 * 60 * 60 * 1000);
});

test("daily briefing filters news by window and marks small candidate pools honestly", async () => {
  const now = new Date("2026-06-30T00:30:00.000Z");
  const brief = await runDailyMarketBriefingPipeline({
    now,
    marketData: [
      { "指数代码": "000001.SH", "指数简称": "上证指数", "涨跌幅[20260630]": 0.5, "成交额[20260630]": 1530326000000 }
    ],
    newsProviders: [
      {
        name: "fixture",
        fetch: async () => [
          { title: "央行逆回购利率下调释放流动性信号", publishedAt: "2026-06-30T00:10:00.000Z", source: "fixture" },
          { title: "过期新闻不应进入候选池", publishedAt: "2026-06-28T23:59:59.000Z", source: "fixture" },
          { title: "NVIDIA AI 数据中心订单继续升温", publishedAt: "2026-06-29T12:00:00.000Z", source: "fixture" }
        ]
      }
    ]
  });

  const news = brief.evidence.find((item) => item.title.startsWith("今日财经快讯"));
  const quality = brief.evidence.find((item) => item.title === "新闻候选池质量");

  assert.ok(news);
  assert.match(news.title, /候选池不足/);
  assert.match(news.excerpt, /央行逆回购利率下调/);
  assert.match(news.excerpt, /NVIDIA AI 数据中心订单/);
  assert.doesNotMatch(news.excerpt, /过期新闻/);
  assert.ok(quality);
  assert.match(quality.excerpt, /固定24小时/);
  assert.match(brief.dataQuality.find((item) => item.name === "新闻候选池").status, /不足 · 2 条/);
});

test("daily briefing includes community signals as a separate evidence layer", async () => {
  const now = new Date("2026-06-30T00:30:00.000Z");
  const brief = await runDailyMarketBriefingPipeline({
    now,
    marketData: [],
    newsProviders: [],
    communitySignals: [
      {
        theme: "AI基础设施",
        signalType: "订单/招标",
        relatedAssets: ["液冷", "服务器"],
        importance: 5,
        verificationStatus: "待验证",
        summary: "AI 服务器订单超预期，液冷供应链交付紧张。"
      }
    ],
    signalSync: {
      ok: true,
      extractionMethod: "fallback",
      source: { title: "社群精选" }
    }
  });

  const signalEvidence = brief.evidence.find((item) => item.title === "社群信号 (1条)");
  assert.ok(signalEvidence);
  assert.match(signalEvidence.excerpt, /AI 服务器订单超预期/);
  assert.match(brief.dataQuality.find((item) => item.name === "社群信号").status, /正常 · 1 条/);
  assert.ok(brief.tags.includes("社群信号"));
});
