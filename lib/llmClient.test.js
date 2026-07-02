import assert from "node:assert/strict";
import test from "node:test";

import { parseLlmJson, extractContent } from "./llmClient.js";

test("parseLlmJson parses plain JSON", () => {
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 });
});

test("parseLlmJson strips markdown code fences", () => {
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLlmJson('```\n{"b":2}\n```'), { b: 2 });
});

test("parseLlmJson recovers JSON embedded in prose", () => {
  assert.deepEqual(parseLlmJson('这是结果：{"a":1} 以上。'), { a: 1 });
});

test("parseLlmJson throws on non-JSON content", () => {
  assert.throws(() => parseLlmJson("完全没有 JSON"), /不是有效 JSON/);
});

test("extractContent reads OpenAI-style choices", () => {
  assert.equal(extractContent({ choices: [{ message: { content: "hi" } }] }), "hi");
});

test("extractContent falls back to output_text then whole payload", () => {
  assert.equal(extractContent({ output_text: "ot" }), "ot");
  assert.equal(extractContent({ x: 1 }), JSON.stringify({ x: 1 }));
});
