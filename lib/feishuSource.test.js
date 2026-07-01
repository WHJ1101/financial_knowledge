import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFeishuSignalRecords,
  importFeishuSignalSource,
  parseFeishuResource
} from "./feishuSource.js";

test("parses feishu wiki links", () => {
  const resource = parseFeishuResource("https://example.feishu.cn/wiki/YTXOwgKaFikMbLkhrVtcPmE0nRV?from=from_copylink");

  assert.equal(resource.kind, "wiki");
  assert.equal(resource.token, "YTXOwgKaFikMbLkhrVtcPmE0nRV");
});

test("builds finance signal records that local source pipeline can consume", () => {
  const records = buildFeishuSignalRecords({
    resource: { kind: "wiki", token: "wiki_token", url: "https://example.feishu.cn/wiki/wiki_token" },
    document: { title: "AI 产业链群精选", objType: "docx", objToken: "docx_token", wikiToken: "wiki_token" },
    content: "光模块交期继续拉长。\n\n国产算力招标反馈升温。",
    now: new Date("2026-06-30T00:30:00.000Z")
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].dataset, "feishu-signal");
  assert.equal(records[0].category, "财经社群信号");
  assert.match(records[0].title, /AI 产业链群精选/);
  assert.match(records[0].content, /光模块交期继续拉长/);
});

test("imports a feishu wiki docx page into data sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "financial-knowledge-feishu-"));
  const requested = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    requested.push({ href, method: options.method || "GET" });

    if (href.endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "tenant_token" });
    }

    if (href.includes("/open-apis/wiki/v2/spaces/get_node")) {
      return jsonResponse({
        code: 0,
        data: {
          node: {
            title: "高质量群组精选",
            obj_type: "docx",
            obj_token: "docx_token",
            node_token: "wiki_node",
            space_id: "space_id"
          }
        }
      });
    }

    if (href.endsWith("/open-apis/docx/v1/documents/docx_token/raw_content")) {
      return jsonResponse({ code: 0, data: { content: "半导体设备订单反馈改善。" } });
    }

    throw new Error(`Unexpected request: ${href}`);
  };

  try {
    const result = await importFeishuSignalSource({
      input: "https://example.feishu.cn/wiki/wiki_token",
      appId: "cli_xxx",
      appSecret: "secret",
      dataDir: root,
      fetchImpl,
      now: new Date("2026-06-30T00:30:00.000Z")
    });

    const payload = JSON.parse(await readFile(result.outputPath, "utf8"));
    assert.equal(result.itemCount, 1);
    assert.equal(payload.items[0].source, "飞书知识库");
    assert.match(payload.items[0].content, /半导体设备订单反馈改善/);
    assert.ok(requested.some((request) => request.href.includes("wiki/v2/spaces/get_node")));
  } finally {
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
