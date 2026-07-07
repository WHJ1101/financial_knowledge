import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-report-lifecycle-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("./db.js");
const { ensureReportRoot, REPORT_DIR } = await import("./report-file-store.js");
const { importReport, saveReport } = await import("./report-lifecycle.js");

await ensureReportRoot();

test("importReport writes HTML file, DB row and log in one call (A1-3)", async () => {
  const report = await importReport({
    title: "生命周期模块测试报告",
    topic: "报告构建路径",
    type: "custom",
    summary: "验证构建/落盘路径",
    localDate: "2026-07-06",
    html: "<section><h2>正文</h2></section>"
  });

  assert.ok(report.id);
  assert.equal(report.title, "生命周期模块测试报告");
  assert.equal(report.origin, "manual");

  const row = db.prepare("SELECT * FROM reports WHERE id=?").get(report.id);
  assert.ok(row, "report row persisted");
  assert.equal(row.title, report.title);

  const html = await readFile(join(REPORT_DIR, report.file), "utf8");
  assert.ok(html.includes("正文"), "report HTML written to disk");

  const log = db.prepare("SELECT * FROM logs WHERE type='report_import' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(log, "import logged");
});

test("importReport rejects payload without title/topic", async () => {
  await assert.rejects(() => importReport({}), /title or topic is required/);
});

test("saveReport requires report.file", async () => {
  await assert.rejects(() => saveReport({ report: { id: "x" }, html: "<p>x</p>" }), /report\.file required/);
});
