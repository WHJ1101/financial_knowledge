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
    sourceTitle: "社群精选",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_token",
    sourceText: "半导体设备订单反馈改善，部分国产设备厂商交付节奏加快。\n\n闲聊内容没有投研价值。",
    now: new Date("2026-06-30T00:30:00.000Z")
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].theme, "半导体");
  assert.equal(signals[0].signalType, "订单/招标");
  assert.equal(signals[0].verificationStatus, "待验证");
  assert.match(signals[0].summary, /半导体设备订单反馈改善/);
});

test("feishu sync imports and extracts community signals without an LLM", async () => {
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
          content: "AI 服务器订单超预期，液冷供应链交付紧张。\n\n港股市场闲聊。"
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
      now: new Date("2026-06-30T00:30:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.extractionMethod, "fallback");
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0].theme, "AI基础设施");
    assert.match(result.signals[0].summary, /AI 服务器订单超预期/);
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
