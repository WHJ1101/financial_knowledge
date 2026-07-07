import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { isFeishuWebhookConfigured, sendFeishuWebhook } from "./feishuWebhook.js";

const HOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/test-uuid";

test("isFeishuWebhookConfigured reflects env", () => {
  const saved = process.env.FEISHU_WEBHOOK_URL;
  delete process.env.FEISHU_WEBHOOK_URL;
  assert.equal(isFeishuWebhookConfigured(), false);
  process.env.FEISHU_WEBHOOK_URL = HOOK;
  assert.equal(isFeishuWebhookConfigured(), true);
  restore("FEISHU_WEBHOOK_URL", saved);
});

test("sends interactive card at top-level card field", async () => {
  let captured = null;
  const fetchImpl = async (url, options = {}) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return jsonResponse({ code: 0, data: {} });
  };

  await sendFeishuWebhook({
    card: { header: { title: { tag: "plain_text", content: "hi" } }, elements: [] },
    webhookUrl: HOOK,
    fetchImpl
  });

  assert.equal(captured.url, HOOK);
  assert.equal(captured.body.msg_type, "interactive");
  assert.ok(captured.body.card, "卡片放在顶层 card 字段");
  assert.equal(captured.body.content, undefined, "不使用 content 字段");
  assert.equal(captured.body.card.header.title.content, "hi");
});

test("falls back to text message", async () => {
  let body = null;
  const fetchImpl = async (url, options = {}) => {
    body = JSON.parse(options.body);
    return jsonResponse({ code: 0 });
  };

  await sendFeishuWebhook({ text: "压力上穿 70", webhookUrl: HOOK, fetchImpl });
  assert.equal(body.msg_type, "text");
  assert.deepEqual(body.content, { text: "压力上穿 70" });
});

test("adds timestamp + sign when secret configured", async () => {
  let body = null;
  const fetchImpl = async (url, options = {}) => {
    body = JSON.parse(options.body);
    return jsonResponse({ code: 0 });
  };
  const now = new Date("2026-07-06T00:00:00.000Z");
  const secret = "my_secret";

  await sendFeishuWebhook({ text: "x", webhookUrl: HOOK, secret, fetchImpl, now });

  const expectedTs = String(Math.floor(now.getTime() / 1000));
  const expectedSign = createHmac("sha256", `${expectedTs}\n${secret}`).update("").digest("base64");
  assert.equal(body.timestamp, expectedTs);
  assert.equal(body.sign, expectedSign);
});

test("no sign fields when secret absent", async () => {
  let body = null;
  const fetchImpl = async (url, options = {}) => {
    body = JSON.parse(options.body);
    return jsonResponse({ code: 0 });
  };
  await sendFeishuWebhook({ text: "x", webhookUrl: HOOK, secret: "", fetchImpl });
  assert.equal(body.timestamp, undefined);
  assert.equal(body.sign, undefined);
});

test("throws on non-zero code (e.g. signature failure 19021)", async () => {
  const fetchImpl = async () => jsonResponse({ code: 19021, msg: "sign match fail" });
  await assert.rejects(() => sendFeishuWebhook({ text: "x", webhookUrl: HOOK, fetchImpl }), /19021/);
});

test("throws when webhook url missing", async () => {
  await assert.rejects(
    () => sendFeishuWebhook({ text: "x", webhookUrl: "", fetchImpl: async () => jsonResponse({ code: 0 }) }),
    /FEISHU_WEBHOOK_URL/
  );
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function jsonResponse(value) {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) };
}
