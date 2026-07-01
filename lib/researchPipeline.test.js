import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runResearchPipeline } from "./researchPipeline.js";

const LLM_ENV_KEYS = [
  "FINANCE_KNOWLEDGE_LLM_API_URL",
  "FINANCE_KNOWLEDGE_LLM_API_KEY",
  "FINANCE_KNOWLEDGE_LLM_MODEL",
  "LLM_API_URL",
  "LLM_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY"
];

test("preserves complete finance news evidence for template rendering", async () => {
  const root = await mkdtemp(join(tmpdir(), "financial-knowledge-test-"));
  const sourceDir = join(root, "sources");
  const savedEnv = Object.fromEntries(["DATA_SOURCE_DIR", ...LLM_ENV_KEYS].map((key) => [key, process.env[key]]));

  try {
    await mkdir(sourceDir, { recursive: true });
    process.env.DATA_SOURCE_DIR = sourceDir;
    for (const key of LLM_ENV_KEYS) delete process.env[key];

    const headlines = Array.from({ length: 20 }, (_, index) => {
      const minute = String(59 - index).padStart(2, "0");
      return `[2026-06-30 15:${minute}:00] 第${index + 1}条重要财经快讯`;
    }).join("\n");

    await writeFile(
      join(sourceDir, "news.json"),
      JSON.stringify([
        {
          title: "今日财经快讯 (20条)",
          content: headlines,
          observedAt: "2026-06-30T07:42:51.035Z"
        }
      ]),
      "utf8"
    );

    const brief = await runResearchPipeline({
      topic: "今日财经快讯",
      type: "market",
      previousReports: [],
      dataDir: root,
      now: new Date("2026-06-30T07:42:51.035Z")
    });

    const news = brief.evidence.find((item) => item.title === "今日财经快讯 (20条)");
    assert.ok(news);
    assert.equal((news.excerpt.match(/\[2026-06-30 15:/g) || []).length, 20);
    assert.match(news.excerpt, /第20条重要财经快讯/);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
