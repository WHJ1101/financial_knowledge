import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeHash, getHashPage, parseHashQuery, parseKnowledgeFilters } from "./hash-route.js";

test("buildKnowledgeHash keeps Chinese search text in hash query", () => {
  const hash = buildKnowledgeHash({ q: "光模块", origin: "manual", topic: "产业链深度", filter: "starred" });
  assert.equal(hash, "#knowledge?q=%E5%85%89%E6%A8%A1%E5%9D%97&origin=manual&topic=%E4%BA%A7%E4%B8%9A%E9%93%BE%E6%B7%B1%E5%BA%A6&filter=starred");
  assert.equal(getHashPage(hash), "#knowledge");
  assert.equal(parseHashQuery(hash).get("q"), "光模块");
});

test("buildKnowledgeHash omits empty and all filters", () => {
  assert.equal(buildKnowledgeHash({ q: "  ", origin: "all", topic: "all", filter: "all" }), "#knowledge");
});

test("parseKnowledgeFilters normalizes invalid values", () => {
  assert.deepEqual(parseKnowledgeFilters("#knowledge?q=%20AI%20&origin=bad&topic=&filter=weird"), {
    q: "AI",
    origin: "all",
    topic: "all",
    filter: "all"
  });
});
