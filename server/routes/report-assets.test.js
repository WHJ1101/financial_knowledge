import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-report-assets-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("../services/db.js");
const { deleteReport, insertReport } = await import("./reports.js");
const {
  deleteReportAssetLink,
  getAssetReportLinks,
  getReportAssetLinks,
  upsertReportAssetLink
} = await import("./report-assets.js");

test("manual report asset links can be queried from both sides and removed", () => {
  insertReportRow({ id: "manual-link-report", title: "贵州茅台跟踪" });

  const link = upsertReportAssetLink("manual-link-report", {
    code: "600519",
    name: "贵州茅台",
    market: "A股"
  });

  assert.equal(link.assetCode, "600519");
  assert.equal(link.assetName, "贵州茅台");
  assert.equal(link.source, "manual");
  assert.equal(getReportAssetLinks("manual-link-report")[0].assetCode, "600519");

  const reports = getAssetReportLinks("600519");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].report.id, "manual-link-report");
  assert.equal(reports[0].report.title, "贵州茅台跟踪");

  assert.deepEqual(deleteReportAssetLink(link.id), { deleted: true });
  assert.deepEqual(getReportAssetLinks("manual-link-report"), []);

  const logs = db.prepare("SELECT type, meta FROM logs WHERE type=? ORDER BY created_at DESC LIMIT 2").all("report_asset_link");
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0].meta).assetCode, "600519");
  assert.equal(JSON.parse(logs[1].meta).assetCode, "600519");
});

test("insertReport creates auto links from codes and known asset names", () => {
  db.prepare("INSERT INTO stocks (code,name,market,status,watch_signals,sparkline,analysis_status,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("300750", "宁德时代", "A股", "观察", "[]", "[]", "done", "2026-07-06T00:00:00.000Z");

  insertReport(buildReport({
    id: "auto-link-report",
    title: "宁德时代与 300750 跟踪",
    topic: "新能源车产业链",
    tags: ["动力电池"]
  }));

  const links = getReportAssetLinks("auto-link-report");
  assert.equal(links.length, 1);
  assert.equal(links[0].assetCode, "300750");
  assert.equal(links[0].assetName, "宁德时代");
  assert.equal(links[0].source, "auto");
});

test("deleteReport removes linked assets together with report metadata", () => {
  insertReportRow({ id: "delete-linked-report", title: "删除关联测试" });
  upsertReportAssetLink("delete-linked-report", { code: "000001", name: "平安银行" });

  assert.equal(getReportAssetLinks("delete-linked-report").length, 1);
  assert.deepEqual(deleteReport("delete-linked-report"), { deleted: true, fileDeleted: false });
  assert.deepEqual(getReportAssetLinks("delete-linked-report"), []);
});

test("auto sync does not remove manual links when a report is regenerated", () => {
  insertReport(buildReport({ id: "preserve-manual-report", title: "招商银行 600036 跟踪" }));
  upsertReportAssetLink("preserve-manual-report", { code: "000651", name: "格力电器" });

  insertReport(buildReport({ id: "preserve-manual-report", title: "无代码主题复盘", tags: [] }));

  const links = getReportAssetLinks("preserve-manual-report");
  assert.equal(links.length, 1);
  assert.equal(links[0].assetCode, "000651");
  assert.equal(links[0].source, "manual");
});

function insertReportRow({ id, title }) {
  db.prepare(`
    INSERT INTO reports
      (id,title,topic,type,type_label,summary,tags,status,starred,archived,source,origin,origin_label,local_date,file,wiki_path,accent,highlights,created_at,updated_at)
    VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    title,
    title,
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
    "2026-07-06",
    "2026-07-06/" + id + ".html",
    "",
    "#0f766e",
    "[]",
    "2026-07-06T00:00:00.000Z",
    "2026-07-06T00:00:00.000Z"
  );
}

function buildReport(overrides = {}) {
  return {
    id: overrides.id,
    title: overrides.title || "测试报告",
    topic: overrides.topic || overrides.title || "测试主题",
    type: "custom",
    typeLabel: "主题调研",
    summary: overrides.summary || "",
    tags: overrides.tags || [],
    status: "new",
    starred: 0,
    archived: 0,
    source: "manual",
    origin: "manual",
    originLabel: "手动产出",
    localDate: "2026-07-06",
    file: "2026-07-06/" + overrides.id + ".html",
    wikiPath: "",
    accent: "#0f766e",
    highlights: overrides.highlights || [],
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  };
}
