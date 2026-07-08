import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fallbackExtractSignals, syncFeishuCommunitySignals } from "./communitySignalPipeline.js";

const ENV_KEYS = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_SIGNAL_WIKI_URL",
  "FINANCE_KNOWLEDGE_LLM_API_URL",
  "FINANCE_KNOWLEDGE_LLM_API_KEY",
  "LLM_API_URL",
  "LLM_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY"
];

test("fallback extraction turns community text into signal cards", () => {
  const signals = fallbackExtractSignals({
    date: "2026-06-30",
    sourceTitle: "社群精选",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_token",
    sourceText: "半导体设备订单反馈改善，部分国产设备厂商交付节奏加快。\n\n闲聊内容没有投研价值。",
    now: new Date("2026-07-08T00:30:00.000Z")
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].theme, "半导体");
  assert.equal(signals[0].date, "2026-06-30");
  assert.equal(signals[0].signalType, "订单/招标");
  assert.equal(signals[0].verificationStatus, "待验证");
  assert.match(signals[0].summary, /半导体设备订单反馈改善/);
});

test("feishu sync extracts community signals per day and dates them by section", async () => {
  const root = await mkdtemp(join(tmpdir(), "financial-knowledge-signal-"));
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "tenant_token" });
    }
    if (href.includes("/open-apis/wiki/v2/spaces/get_node")) {
      return jsonResponse({
        code: 0,
        data: {
          node: {
            title: "社群精选",
            obj_type: "docx",
            obj_token: "docx_token"
          }
        }
      });
    }
    if (href.endsWith("/open-apis/docx/v1/documents/docx_token/raw_content")) {
      return jsonResponse({
        code: 0,
        data: {
          content: [
            "社群精选",
            "2026-06-30",
            "AI 服务器订单超预期，液冷供应链交付紧张。",
            "港股市场闲聊。",
            "",
            "2026-06-29",
            "半导体设备订单反馈改善，国产替代逻辑强。"
          ].join("\n")
        }
      });
    }
    throw new Error(`Unexpected request: ${href}`);
  };

  try {
    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret";
    process.env.FEISHU_SIGNAL_WIKI_URL = "https://example.feishu.cn/wiki/wiki_token";
    for (const key of ENV_KEYS.filter((key) => /LLM|OPENAI/.test(key))) delete process.env[key];

    const result = await syncFeishuCommunitySignals({
      dataDir: root,
      fetchImpl,
      now: new Date("2026-07-08T00:30:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.extractionMethod, "fallback");
    assert.deepEqual(result.processedDates, ["2026-06-30", "2026-06-29"]);
    assert.equal(result.days.length, 2);

    const june30 = result.signals.find((signal) => signal.date === "2026-06-30");
    assert.ok(june30, "expected a signal dated 2026-06-30");
    assert.equal(june30.theme, "AI基础设施");
    assert.match(june30.summary, /AI 服务器订单超预期/);
    // 有效期锚定信号所属日期，而非同步时间。
    assert.equal(june30.expiresAt.slice(0, 10), "2026-07-14");

    assert.ok(result.signals.some((signal) => signal.date === "2026-06-29"));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("feishu sync skips days already stored", async () => {
  const root = await mkdtemp(join(tmpdir(), "financial-knowledge-signal-skip-"));
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "tenant_token" });
    }
    if (href.includes("/open-apis/wiki/v2/spaces/get_node")) {
      return jsonResponse({ code: 0, data: { node: { title: "社群精选", obj_type: "docx", obj_token: "docx_token" } } });
    }
    if (href.endsWith("/open-apis/docx/v1/documents/docx_token/raw_content")) {
      return jsonResponse({
        code: 0,
        data: { content: ["2026-06-30", "AI 服务器订单超预期。", "", "2026-06-29", "半导体设备订单反馈改善。"].join("\n") }
      });
    }
    throw new Error(`Unexpected request: ${href}`);
  };

  try {
    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret";
    process.env.FEISHU_SIGNAL_WIKI_URL = "https://example.feishu.cn/wiki/wiki_token";
    for (const key of ENV_KEYS.filter((key) => /LLM|OPENAI/.test(key))) delete process.env[key];

    const result = await syncFeishuCommunitySignals({
      dataDir: root,
      fetchImpl,
      now: new Date("2026-07-08T00:30:00.000Z"),
      shouldProcessDate: (date) => date !== "2026-06-30"
    });

    assert.deepEqual(result.processedDates, ["2026-06-29"]);
    assert.deepEqual(result.skippedDates, ["2026-06-30"]);
    assert.ok(result.signals.every((signal) => signal.date === "2026-06-29"));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value)
  };
}
