import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`Usage:
  node scripts/import-report.js report.json
  cat report.json | node scripts/import-report.js -

Environment:
  FINANCE_KNOWLEDGE_BASE_URL      Default: http://127.0.0.1:4173
  FINANCE_KNOWLEDGE_IMPORT_TOKEN  Optional Bearer token for cloud import

JSON fields:
  title, topic, type, summary, tags, highlights, html | content | markdown
`);
  process.exit(0);
}

const inputPath = args[0] || "-";
const baseUrl = (process.env.FINANCE_KNOWLEDGE_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const token = process.env.FINANCE_KNOWLEDGE_IMPORT_TOKEN || process.env.REPORT_IMPORT_TOKEN || "";

const raw = inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8");
const payload = JSON.parse(raw);

const response = await fetch(`${baseUrl}/api/reports/import`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify({ source: "chat", ...payload })
});

const data = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(data.error || `Import failed with HTTP ${response.status}`);
  process.exit(1);
}

console.log(`已入库：${data.report.title}`);
console.log(`${baseUrl}/#report/${encodeURIComponent(data.report.id)}`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
