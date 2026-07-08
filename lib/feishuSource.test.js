import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFeishuSignalDays,
  importFeishuSignalSource,
  parseFeishuResource
} from "./feishuSource.js";

test("parses feishu wiki links", () => {
  const resource = parseFeishuResource("https://example.feishu.cn/wiki/YTXOwgKaFikMbLkhrVtcPmE0nRV?from=from_copylink");

  assert.equal(resource.kind, "wiki");
  assert.equal(resource.token, "YTXOwgKaFikMbLkhrVtcPmE0nRV");
});

test("splits feishu content into day-level sections", () => {
  const days = buildFeishuSignalDays({
    document: { title: "AI 产业链群精选" },
    content: [
      "SageX 日报 · 精选",
      "2026-06-30",
      "2026-06-30 · 精选",
      "光模块交期继续拉长。",
      "",
      "2026-06-29",
      "国产算力招标反馈升温。"
    ].join("\n")
  });

  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-06-30");
  assert.match(days[0].content, /光模块交期继续拉长/);
  assert.doesNotMatch(days[0].content, /国产算力招标/);
  assert.equal(days[1].date, "2026-06-29");
  assert.match(days[1].content, /国产算力招标反馈升温/);
});

test("drops days that contain only image attachments", () => {
  const days = buildFeishuSignalDays({
    document: { title: "群精选" },
    content: [
      "2026-06-30",
      "半导体设备订单反馈改善。",
      "",
      "2026-06-27",
      "digest-2026-06-27.png",
      "wangsanshu-2026-06-27.png"
    ].join("\n")
  });

  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-06-30");
});

test("falls back to a single day when no day heading exists", () => {
  const days = buildFeishuSignalDays({
    document: { title: "群精选" },
    content: "半导体设备订单反馈改善。",
    now: new Date("2026-06-30T00:30:00.000Z")
  });

  assert.equal(days.length, 1);
  assert.match(days[0].content, /半导体设备订单反馈改善/);
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
      return jsonResponse({ code: 0, data: { content: "2026-06-30\n半导体设备订单反馈改善。" } });
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
    assert.equal(result.dayCount, 1);
    assert.equal(payload.days[0].date, "2026-06-30");
    assert.match(payload.days[0].content, /半导体设备订单反馈改善/);
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
