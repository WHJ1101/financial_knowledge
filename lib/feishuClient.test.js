import assert from "node:assert/strict";
import test from "node:test";

import { getTenantAccessToken, resetFeishuClientCache } from "./feishuClient.js";

test("caches tenant_access_token until near expiry", async () => {
  resetFeishuClientCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ code: 0, tenant_access_token: `token_${calls}`, expire: 7200 });
  };

  const first = await getTenantAccessToken({ appId: "cli_a", appSecret: "s", fetchImpl, now: 0 });
  const second = await getTenantAccessToken({ appId: "cli_a", appSecret: "s", fetchImpl, now: 1000 });

  assert.equal(first, "token_1");
  assert.equal(second, "token_1", "第二次命中缓存，不再请求");
  assert.equal(calls, 1);
});

test("refreshes token after expiry window", async () => {
  resetFeishuClientCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ code: 0, tenant_access_token: `token_${calls}`, expire: 7200 });
  };

  await getTenantAccessToken({ appId: "cli_b", appSecret: "s", fetchImpl, now: 0 });
  // expire 7200 - buffer 300 = 6900s 后过期；跨过该点应重新请求。
  const refreshed = await getTenantAccessToken({ appId: "cli_b", appSecret: "s", fetchImpl, now: 6901 * 1000 });

  assert.equal(refreshed, "token_2");
  assert.equal(calls, 2);
});

test("token cache is keyed by appId", async () => {
  resetFeishuClientCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ code: 0, tenant_access_token: `token_${calls}`, expire: 7200 });
  };

  await getTenantAccessToken({ appId: "cli_x", appSecret: "s", fetchImpl, now: 0 });
  await getTenantAccessToken({ appId: "cli_y", appSecret: "s", fetchImpl, now: 0 });
  assert.equal(calls, 2, "不同 appId 各取各的 token");
});

test("throws when credentials missing", async () => {
  resetFeishuClientCache();
  await assert.rejects(() => getTenantAccessToken({ appId: "", appSecret: "", fetchImpl: async () => ({}) }), /FEISHU_APP_ID/);
});

function jsonResponse(value) {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) };
}
