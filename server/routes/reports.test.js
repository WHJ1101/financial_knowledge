import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-reports-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("../services/db.js");
const { deleteReport } = await import("./reports.js");

test("deleteReport removes metadata and html file", async () => {
  const id = "delete-report-normal";
  const file = "2026-07-02/delete-report-normal.html";
  await mkdir(join(root, "reports", "2026-07-02"), { recursive: true });
  await writeFile(join(root, "reports", file), "<html></html>", "utf8");
  insertReport({ id, file });

  assert.deepEqual(deleteReport(id), { deleted: true, fileDeleted: true });
  assert.equal(existsSync(join(root, "reports", file)), false);
  assert.equal(db.prepare("SELECT id FROM reports WHERE id=?").get(id), undefined);
  assert.equal(db.prepare("SELECT type FROM logs WHERE type='report_delete'").get().type, "report_delete");
});

test("deleteReport succeeds when html file is already missing", () => {
  const id = "delete-report-missing-file";
  insertReport({ id, file: "2026-07-02/missing.html" });

  assert.deepEqual(deleteReport(id), { deleted: true, fileDeleted: false });
  assert.equal(db.prepare("SELECT id FROM reports WHERE id=?").get(id), undefined);
});

test("deleteReport returns null when report does not exist", () => {
  assert.equal(deleteReport("missing-report-id"), null);
});

function insertReport({ id, file }) {
  db.prepare(`
    INSERT INTO reports
      (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at)
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    "测试报告",
    "测试主题",
    "custom",
    "主题调研",
    "summary",
    "[]",
    "new",
    0,
    0,
    "manual",
    "manual",
    "手动产出",
    "2026-07-02",
    file,
    "",
    "#0f766e",
    "[]",
    "2026-07-02T00:00:00.000Z",
    "2026-07-02T00:00:00.000Z"
  );
}
