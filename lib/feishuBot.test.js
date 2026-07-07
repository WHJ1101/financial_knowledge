import assert from "node:assert/strict";
import test from "node:test";

import { resetFeishuClientCache } from "./feishuClient.js";
import { isFeishuPushConfigured, resolveReceiver, sendFeishuMessage } from "./feishuBot.js";

const RECEIVER_KEYS = ["FEISHU_PUSH_CHAT_ID", "FEISHU_PUSH_OPEN_ID", "FEISHU_PUSH_USER_ID", "FEISHU_PUSH_EMAIL"];

function clearReceiverEnv() {
  for (const key of RECEIVER_KEYS) delete process.env[key];
}

test("resolveReceiver prefers chat_id then falls back by priority", () => {
  clearReceiverEnv();
  assert.equal(resolveReceiver(), null);

  process.env.FEISHU_PUSH_EMAIL = "a@example.com";
  assert.deepEqual(resolveReceiver(), { receiveIdType: "email", receiveId: "a@example.com" });

  process.env.FEISHU_PUSH_OPEN_ID = "ou_x";
  assert.deepEqual(resolveReceiver(), { receiveIdType: "open_id", receiveId: "ou_x" });

  process.env.FEISHU_PUSH_CHAT_ID = "oc_x";
  assert.deepEqual(resolveReceiver(), { receiveIdType: "chat_id", receiveId: "oc_x" });

  // 显式入参覆盖环境变量。
  assert.deepEqual(resolveReceiver({ openId: "ou_explicit" }), { receiveIdType: "chat_id", receiveId: "oc_x" });
  clearReceiverEnv();
});

test("isFeishuPushConfigured needs both credentials and a receiver", () => {
  clearReceiverEnv();
  const saved = { id: process.env.FEISHU_APP_ID, secret: process.env.FEISHU_APP_SECRET };
  process.env.FEISHU_APP_ID = "cli_x";
  process.env.FEISHU_APP_SECRET = "secret";
  assert.equal(isFeishuPushConfigured(), false, "无接收方 → false");

  process.env.FEISHU_PUSH_CHAT_ID = "oc_x";
  assert.equal(isFeishuPushConfigured(), true);

  delete process.env.FEISHU_APP_ID;
  assert.equal(isFeishuPushConfigured(), false, "无凭证 → false");

  restore("FEISHU_APP_ID", saved.id);
  restore("FEISHU_APP_SECRET", saved.secret);
  clearReceiverEnv();
});

test("sendFeishuMessage posts an interactive card to im/v1/messages", async () => {
  resetFeishuClientCache();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    requests.push({ href, options });
    if (href.endsWith("/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "tenant_token", expire: 7200 });
    }
    if (href.includes("/open-apis/im/v1/messages")) {
      return jsonResponse({ code: 0, data: { message_id: "om_123" } });
    }
    throw new Error(`Unexpected request: ${href}`);
  };

  const result = await sendFeishuMessage({
    card: { header: { title: { tag: "plain_text", content: "hi" } }, elements: [] },
    receiver: { chatId: "oc_target" },
    appId: "cli_x",
    appSecret: "secret",
    fetchImpl
  });

  assert.equal(result.message_id, "om_123");

  const send = requests.find((r) => r.href.includes("/open-apis/im/v1/messages"));
  assert.ok(send, "调用了发消息接口");
  assert.match(send.href, /receive_id_type=chat_id/);
  const body = JSON.parse(send.options.body);
  assert.equal(body.receive_id, "oc_target");
  assert.equal(body.msg_type, "interactive");
  assert.equal(typeof body.content, "string", "content 必须是 JSON 字符串");
  assert.deepEqual(JSON.parse(body.content).header.title.content, "hi");
});

test("sendFeishuMessage sends plain text when no card provided", async () => {
  resetFeishuClientCache();
  let sentBody = null;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 });
    }
    sentBody = JSON.parse(options.body);
    return jsonResponse({ code: 0, data: { message_id: "om_text" } });
  };

  await sendFeishuMessage({ text: "压力上穿 70", receiver: { openId: "ou_x" }, appId: "cli_x", appSecret: "s", fetchImpl });

  assert.equal(sentBody.msg_type, "text");
  assert.deepEqual(JSON.parse(sentBody.content), { text: "压力上穿 70" });
});

test("sendFeishuMessage throws when no receiver resolvable", async () => {
  clearReceiverEnv();
  await assert.rejects(
    () => sendFeishuMessage({ text: "x", appId: "cli_x", appSecret: "s", fetchImpl: async () => jsonResponse({ code: 0 }) }),
    /接收方/
  );
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function jsonResponse(value) {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) };
}
