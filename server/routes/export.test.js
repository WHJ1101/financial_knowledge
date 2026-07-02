import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-export-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("../services/db.js");
const { buildExport } = await import("./export.js");

test("positions CSV export escapes commas and quotes", () => {
  db.prepare(`
    INSERT INTO positions (id,code,name,market,shares,cost,reason,risk,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run("p1", "000001", "测试,标的", "A股", 10, 2.5, "理由\"A\"", "风险\n换行", "2026-07-02T00:00:00.000Z");

  const payload = buildExport("positions", "csv");
  assert.equal(payload.contentType, "text/csv; charset=utf-8");
  assert.match(payload.body, /"测试,标的"/);
  assert.match(payload.body, /"理由""A"""/);
  assert.match(payload.body, /"风险\n换行"/);
});

test("reports JSON export contains metadata only", () => {
  db.prepare(`
    INSERT INTO reports
      (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at)
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "r1", "报告", "主题", "custom", "主题调研", "摘要", "[]", "new", 0, 0,
    "manual", "manual", "手动产出", "2026-07-02", "secret.html", "wiki/path", "#0f766e", "[]",
    "2026-07-02T00:00:00.000Z", "2026-07-02T00:00:00.000Z"
  );

  const payload = buildExport("reports", "json");
  const data = JSON.parse(payload.body);
  assert.equal(data.reports[0].title, "报告");
  assert.equal("file" in data.reports[0], false);
});
