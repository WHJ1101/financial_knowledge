import { createHash } from "node:crypto";

import db from "../services/db.js";
import { appendLog } from "../services/logs.js";

const CODE_RE = /(^|[^\d])(\d{6})(?!\d)/g;

export function getReportAssetLinks(reportId) {
  return db.prepare(`
    SELECT * FROM report_asset_links
    WHERE report_id=?
    ORDER BY source='manual' DESC, created_at DESC
  `).all(reportId).map(formatAssetLink);
}

export function getAssetReportLinks(assetCode) {
  const code = normalizeAssetCode(assetCode);
  if (!code) return [];
  return db.prepare(`
    SELECT
      l.*,
      r.title AS report_title,
      r.topic AS report_topic,
      r.type AS report_type,
      r.type_label AS report_type_label,
      r.summary AS report_summary,
      r.origin AS report_origin,
      r.origin_label AS report_origin_label,
      r.local_date AS report_local_date,
      r.status AS report_status,
      r.starred AS report_starred,
      r.archived AS report_archived,
      r.created_at AS report_created_at,
      r.updated_at AS report_updated_at
    FROM report_asset_links l
    JOIN reports r ON r.id = l.report_id
    WHERE l.asset_code=? AND COALESCE(r.archived, 0)=0
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all(code).map(formatAssetReportLink);
}

export function upsertReportAssetLink(reportId, body = {}) {
  const code = normalizeAssetCode(body.assetCode || body.code);
  if (!reportId) throw Object.assign(new Error("reportId required"), { statusCode: 400 });
  if (!code) throw Object.assign(new Error("assetCode required"), { statusCode: 400 });
  const report = db.prepare("SELECT id FROM reports WHERE id=?").get(reportId);
  if (!report) throw Object.assign(new Error("Report not found"), { statusCode: 404 });

  const link = upsertLink({
    reportId,
    assetCode: code,
    assetName: body.assetName || body.name || "",
    assetMarket: body.assetMarket || body.market || "",
    relation: body.relation || "related",
    source: body.source || "manual"
  });
  appendLog("report_asset_link", "Saved report asset link: " + reportId + " -> " + code, { reportId, assetCode: code, relation: link.relation, source: link.source });
  return link;
}

export function deleteReportAssetLink(id) {
  const row = db.prepare("SELECT * FROM report_asset_links WHERE id=?").get(id);
  const changes = db.prepare("DELETE FROM report_asset_links WHERE id=?").run(id).changes;
  if (changes > 0) appendLog("report_asset_link", "Deleted report asset link: " + id, { id, reportId: row?.report_id, assetCode: row?.asset_code });
  return { deleted: changes > 0 };
}

export function deleteReportAssetLinks(reportId) {
  db.prepare("DELETE FROM report_asset_links WHERE report_id=?").run(reportId);
}

export function syncAutoReportAssetLinks(report) {
  if (!report?.id) return [];
  db.prepare("DELETE FROM report_asset_links WHERE report_id=? AND source='auto'").run(report.id);
  const assets = extractAssetHints(report);
  return assets.map(asset => upsertLink({
    reportId: report.id,
    assetCode: asset.code,
    assetName: asset.name,
    assetMarket: asset.market,
    relation: "mentioned",
    source: "auto"
  }));
}

function upsertLink({ reportId, assetCode, assetName = "", assetMarket = "", relation = "related", source = "manual" }) {
  const now = new Date().toISOString();
  const normalizedRelation = normalizeText(relation) || "related";
  const normalizedSource = normalizeText(source) || "manual";
  const id = makeLinkId(reportId, assetCode, normalizedRelation, normalizedSource);
  db.prepare(`
    INSERT INTO report_asset_links
      (id, report_id, asset_code, asset_name, asset_market, relation, source, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_id, asset_code, relation, source) DO UPDATE SET
      asset_name=excluded.asset_name,
      asset_market=excluded.asset_market,
      updated_at=excluded.updated_at
  `).run(
    id,
    reportId,
    assetCode,
    normalizeText(assetName),
    normalizeText(assetMarket),
    normalizedRelation,
    normalizedSource,
    now,
    now
  );
  return formatAssetLink(db.prepare("SELECT * FROM report_asset_links WHERE report_id=? AND asset_code=? AND relation=? AND source=?").get(reportId, assetCode, normalizedRelation, normalizedSource));
}

function extractAssetHints(report) {
  const knownAssets = getKnownAssets();
  const byCode = new Map();
  const texts = [
    report.title,
    report.topic,
    report.summary,
    ...(Array.isArray(report.tags) ? report.tags : parseJsonList(report.tags)),
    ...(Array.isArray(report.highlights) ? report.highlights : parseJsonList(report.highlights))
  ].filter(Boolean).map(String);
  const haystack = texts.join(" ");

  for (const text of texts) {
    CODE_RE.lastIndex = 0;
    let match;
    while ((match = CODE_RE.exec(text))) {
      // 只对已知资产（持仓/自选/手动行情中存在的代码）自动建链。
      // 正文里的普通 6 位数字（金额、成交额等）不应误判为标的，需求 Open Decision 4 明确要求避免误关联。
      const known = knownAssets.get(match[2]);
      if (known) addAsset(byCode, known);
    }
  }

  for (const asset of knownAssets.values()) {
    if (asset.name && asset.name.length >= 2 && haystack.includes(asset.name)) addAsset(byCode, asset);
  }

  return Array.from(byCode.values()).slice(0, 20);
}

function getKnownAssets() {
  const rows = [
    ...db.prepare("SELECT code, name, market FROM positions").all(),
    ...db.prepare("SELECT code, name, market FROM stocks").all(),
    ...db.prepare("SELECT code, name, market FROM quote_overrides").all()
  ];
  const byCode = new Map();
  for (const row of rows) addAsset(byCode, row);
  return byCode;
}

function addAsset(byCode, row) {
  const code = normalizeAssetCode(row.code);
  if (!code || byCode.has(code)) return;
  byCode.set(code, {
    code,
    name: normalizeText(row.name),
    market: normalizeText(row.market)
  });
}

function normalizeAssetCode(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeLinkId(reportId, assetCode, relation, source) {
  return createHash("sha1").update(`${reportId}:${assetCode}:${relation}:${source}`).digest("hex").slice(0, 20);
}

function formatAssetLink(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportId: row.report_id,
    assetCode: row.asset_code,
    assetName: row.asset_name || "",
    assetMarket: row.asset_market || "",
    relation: row.relation || "related",
    source: row.source || "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatAssetReportLink(row) {
  const link = formatAssetLink(row);
  return {
    ...link,
    report: {
      id: row.report_id,
      title: row.report_title,
      topic: row.report_topic,
      type: row.report_type,
      typeLabel: row.report_type_label,
      summary: row.report_summary,
      origin: row.report_origin,
      originLabel: row.report_origin_label,
      localDate: row.report_local_date,
      status: row.report_status,
      starred: !!row.report_starred,
      archived: !!row.report_archived,
      createdAt: row.report_created_at,
      updatedAt: row.report_updated_at
    }
  };
}
