import db from "../services/db.js";

const POSITION_COLUMNS = [
  ["code", "代码"],
  ["name", "名称"],
  ["market", "市场"],
  ["shares", "数量"],
  ["cost", "成本价"],
  ["reason", "持仓理由"],
  ["risk", "风险"],
  ["updated_at", "更新时间"]
];

const REPORT_COLUMNS = [
  ["id", "ID"],
  ["title", "标题"],
  ["topic", "主题"],
  ["type_label", "类型"],
  ["summary", "摘要"],
  ["tags", "标签"],
  ["status", "状态"],
  ["starred", "标星"],
  ["archived", "归档"],
  ["source", "来源"],
  ["origin", "产出方式"],
  ["local_date", "日期"],
  ["wiki_path", "Wiki 路径"],
  ["created_at", "创建时间"],
  ["updated_at", "更新时间"]
];

export function buildExport(kind, format) {
  if (kind === "positions") return buildPositionsExport(format);
  if (kind === "reports") return buildReportsExport(format);
  throw Object.assign(new Error("Unsupported export kind"), { statusCode: 404 });
}

function buildPositionsExport(format) {
  const rows = db.prepare("SELECT code,name,market,shares,cost,reason,risk,updated_at FROM positions ORDER BY updated_at DESC").all();
  return buildPayload("positions", rows, POSITION_COLUMNS, format);
}

function buildReportsExport(format) {
  const rows = db.prepare(`
    SELECT id,title,topic,type_label,summary,tags,status,starred,archived,source,origin,local_date,wiki_path,created_at,updated_at
    FROM reports
    ORDER BY created_at DESC
  `).all();
  return buildPayload("reports", rows, REPORT_COLUMNS, format);
}

function buildPayload(name, rows, columns, format) {
  if (format === "json") {
    return {
      filename: `${name}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ [name]: rows }, null, 2)
    };
  }
  if (format === "csv") {
    return {
      filename: `${name}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(rows, columns)
    };
  }
  throw Object.assign(new Error("Unsupported export format"), { statusCode: 404 });
}

function toCsv(rows, columns) {
  const header = columns.map(([, label]) => escapeCsv(label)).join(",");
  const lines = rows.map((row) => columns.map(([key]) => escapeCsv(row[key])).join(","));
  return [header, ...lines].join("\n") + "\n";
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
