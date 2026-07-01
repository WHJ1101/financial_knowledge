import assert from "node:assert/strict";
import test from "node:test";

import { modernizeReportHtml, renderReportHtml } from "./report.js";

const report = {
  title: "2026-06-30 每日市场简报",
  typeLabel: "每日简报",
  origin: "automation",
  source: "daily",
  tags: [],
  accent: "#2563eb",
  createdAt: "2026-06-30T07:42:51.034Z"
};

const briefBase = {
  summary: "市场简报",
  highlights: [],
  watchList: [],
  risks: [],
  nextSteps: [],
  dataQuality: []
};

test("renders pipe-delimited leading sectors as a leaderboard", () => {
  const html = renderReportHtml(report, {
    ...briefBase,
    evidence: [
      {
        title: "领涨板块",
        source: "问财行情",
        excerpt: [
          "指数代码: 884288.TI | 指数简称: 模拟芯片设计 | 指数类型: 同花顺三级行业指数 | 成分领域: A股指数 | 涨跌幅[20260630]: 8.7391",
          "指数代码: 884096.TI | 指数简称: 光学元件 | 指数类型: 同花顺三级行业指数 | 成分领域: A股指数 | 涨跌幅[20260630]: 8.0176"
        ].join("\n")
      }
    ]
  });

  assert.match(html, /<div class="leader-list">/);
  assert.match(html, /模拟芯片设计/);
  assert.match(html, /8\.74%/);
  assert.doesNotMatch(html, /<p class="dataset-text">[^<]*指数代码/);
});

test("modernizes legacy report cards without exposing raw sector rows", () => {
  const legacy = `<!doctype html><html lang="zh-CN"><head></head><body>
    <div class="source-item"><strong>领涨板块</strong><span class="source-meta">问财行情 · 2026-06-30</span><p>指数代码: 884288.TI | 指数简称: 模拟芯片设计 | 指数类型: 同花顺三级行业指数 | 成分领域: A股指数 | 涨跌幅[20260630]: 8.7391
指数代码: 884096.TI | 指数简称: 光学元件 | 指数类型: 同花顺三级行业指数 | 成分领域: A股指数 | 涨跌幅[20260630]: 8.0176</p></div>
  </body></html>`;

  const html = modernizeReportHtml(legacy);

  assert.match(html, /modern-evidence-styles/);
  assert.match(html, /<div class="leader-list">/);
  assert.match(html, /模拟芯片设计/);
  assert.match(html, /8\.74%/);
  assert.doesNotMatch(html, /<p class="dataset-text">[^<]*指数代码/);
});

test("renders finance headlines as an importance-ranked compact news list", () => {
  const html = renderReportHtml(report, {
    ...briefBase,
    evidence: [
      {
        title: "今日财经快讯 (20条)",
        source: "东方财富快讯",
        excerpt: [
          "[2026-06-30 15:39:09] 马士基股价抹去日内涨幅",
          "[2026-06-30 15:36:22] 外交部：中方始终愿意在平等友好的基础上推动同印度各领域合作",
          "[2026-06-30 15:20:00] 央行逆回购利率下调释放流动性信号",
          "[2026-06-30 15:18:00] 国产AI芯片主线继续升温"
        ].join(" ")
      }
    ]
  });

  assert.match(html, /<div class="news-list">/);
  assert.match(html, /按重要性筛选 4 \/ 4 条/);
  assert.match(html, /今日最重要的 5 条 · 候选\(20条，已保存4条\)/);
  assert.match(html, /候选快讯 Top 20/);
  assert.match(html, /马士基股价抹去日内涨幅/);
  assert.ok(html.indexOf("央行逆回购利率下调释放流动性信号") < html.indexOf("马士基股价抹去日内涨幅"));
  assert.ok(html.indexOf("国产AI芯片主线继续升温") < html.indexOf("马士基股价抹去日内涨幅"));
  assert.doesNotMatch(html, /<p class="source-snippet">[^<]*马士基股价/);
});

test("labels insufficient news candidate pools instead of overstating top news", () => {
  const html = renderReportHtml(report, {
    ...briefBase,
    evidence: [
      {
        title: "今日财经快讯 (2条，候选池不足)",
        source: "多源快讯",
        excerpt: [
          "[2026-06-30 08:10:00] 央行逆回购利率下调释放流动性信号",
          "[2026-06-30 07:20:00] NVIDIA AI 数据中心订单继续升温"
        ].join("\n")
      }
    ]
  });

  assert.match(html, /候选池不足，仅采集 2 条/);
  assert.doesNotMatch(html, /今日最重要的 5 条/);
});
