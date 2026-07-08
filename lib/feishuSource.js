import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FEISHU_BASE_URL, fetchFeishuJson, feishuAuthHeaders, getTenantAccessToken } from "./feishuClient.js";
import { localDate } from "./datetime.js";

// 飞书日报正文里每天用一行 YYYY-MM-DD 标题分隔。允许可选的 “· 群名” 后缀，
// 且整行不宜过长（否则可能是正文中恰好以日期开头的段落）。
const DAY_HEADING = /^(\d{4})-(\d{2})-(\d{2})(?:\s*·.*)?$/;
const MAX_DAY_HEADING_LENGTH = 40;

export async function importFeishuSignalSource({
  input,
  appId = process.env.FEISHU_APP_ID,
  appSecret = process.env.FEISHU_APP_SECRET,
  dataDir,
  fetchImpl = globalThis.fetch,
  now = new Date()
}) {
  if (!dataDir) throw new Error("缺少 dataDir");
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET");

  const resource = parseFeishuResource(input || process.env.FEISHU_SIGNAL_WIKI_URL || process.env.FEISHU_SIGNAL_URL);
  const tenantAccessToken = await getTenantAccessToken({ appId, appSecret, fetchImpl });
  const document = await resolveFeishuDocument({ resource, tenantAccessToken, fetchImpl });
  const content = await fetchDocumentRawContent({ document, tenantAccessToken, fetchImpl });
  const days = buildFeishuSignalDays({ document, content, now });
  const outputPath = await writeFeishuSignalFile({ resource, document, days, dataDir, now });

  return {
    outputPath,
    title: document.title || "飞书社群信号",
    resource,
    document,
    days,
    dayCount: days.length,
    contentLength: content.length
  };
}

export function parseFeishuResource(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("缺少飞书 Wiki 或文档链接");

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts[index];
      const token = cleanToken(parts[index + 1]);
      if (key === "wiki" && token) return { kind: "wiki", token, url: value };
      if (key === "docx" && token) return { kind: "docx", token, url: value };
      if ((key === "doc" || key === "docs") && token) return { kind: "doc", token, url: value };
    }
  } catch {
    // Fall through to raw token parsing.
  }

  const token = cleanToken(value);
  if (!token) throw new Error("无法从输入中解析飞书 token");
  return { kind: "wiki", token, url: null };
}

export async function resolveFeishuDocument({ resource, tenantAccessToken, fetchImpl = globalThis.fetch }) {
  if (resource.kind === "wiki") {
    const node = await getWikiNode({ wikiToken: resource.token, tenantAccessToken, fetchImpl });
    return {
      title: node.title || "飞书 Wiki 文档",
      objType: node.obj_type || node.objType,
      objToken: node.obj_token || node.objToken,
      wikiToken: resource.token,
      spaceId: node.space_id || node.spaceId,
      nodeToken: node.node_token || node.nodeToken
    };
  }

  return {
    title: resource.kind === "docx" ? "飞书文档" : "飞书旧版文档",
    objType: resource.kind,
    objToken: resource.token,
    wikiToken: null,
    spaceId: null,
    nodeToken: null
  };
}

// 把飞书日报正文按 “YYYY-MM-DD” 天级标题切分为多天。
// 每天返回 { date, title, content }，其中 content 已剥离纯附件（图片文件名）行。
// 只含附件、无正文的天（例如历史日期只留了 digest 截图）会被丢弃。
// 若文档没有任何天级标题（如手工导入的单段文本），整段归为 now 当天。
export function buildFeishuSignalDays({ document, content, now = new Date() }) {
  const normalizedContent = normalizeText(content);
  if (!normalizedContent) throw new Error("飞书文档内容为空");

  const title = document.title || "飞书社群信号";
  const sections = splitContentByDay(normalizedContent);
  const days = sections.length ? sections : [{ date: localDate(now), content: normalizedContent }];

  return days
    .map((day) => ({
      date: day.date,
      title: `飞书社群信号：${title} · ${day.date}`,
      content: day.content
    }))
    .filter((day) => day.content);
}

// 按天级标题行切分正文。标题行之前的前言（文档标题、总览）归入第一天。
function splitContentByDay(content) {
  const lines = content.split("\n");
  const days = [];
  let current = null;

  for (const line of lines) {
    const date = matchDayHeading(line);
    if (date) {
      current = { date, lines: [] };
      // 同一天可能出现重复标题行（如 "2026-06-28" 紧跟 "2026-06-28 · 群名"），合并到同一天。
      const previous = days[days.length - 1];
      if (previous && previous.date === date) {
        current = previous;
        continue;
      }
      days.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    // 首个日期标题之前的内容（文档标题等）无归属，直接忽略。
  }

  return days.map((day) => ({
    date: day.date,
    content: normalizeText(dropAttachmentLines(day.lines).join("\n"))
  }));
}

function matchDayHeading(line) {
  const text = line.trim();
  if (text.length > MAX_DAY_HEADING_LENGTH) return null;
  const matched = DAY_HEADING.exec(text);
  return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : null;
}

// 丢弃纯附件行（如 digest-2026-06-27.png），这类行没有可抽取的文本信号。
function dropAttachmentLines(lines) {
  return lines.filter((line) => !/^\s*[\w.-]+\.(png|jpe?g|gif|webp|bmp|pdf)\s*$/i.test(line));
}


async function getWikiNode({ wikiToken, tenantAccessToken, fetchImpl }) {
  const url = new URL(`${FEISHU_BASE_URL}/open-apis/wiki/v2/spaces/get_node`);
  url.searchParams.set("token", wikiToken);
  const json = await fetchFeishuJson({
    fetchImpl,
    url,
    headers: feishuAuthHeaders(tenantAccessToken)
  });
  const node = json.data?.node || json.node || json.data;
  if (!node?.obj_token && !node?.objToken) throw new Error("飞书 Wiki 节点未返回 obj_token");
  return node;
}

async function fetchDocumentRawContent({ document, tenantAccessToken, fetchImpl }) {
  const type = String(document.objType || "").toLowerCase();
  if (!document.objToken) throw new Error("缺少飞书文档 obj_token");

  if (type === "docx") {
    return extractRawContent(await fetchFeishuJson({
      fetchImpl,
      url: `${FEISHU_BASE_URL}/open-apis/docx/v1/documents/${document.objToken}/raw_content`,
      headers: feishuAuthHeaders(tenantAccessToken)
    }));
  }

  if (type === "doc") {
    return fetchLegacyDocRawContent({ document, tenantAccessToken, fetchImpl });
  }

  throw new Error(`暂不支持读取飞书对象类型：${document.objType || "未知"}`);
}

async function fetchLegacyDocRawContent({ document, tenantAccessToken, fetchImpl }) {
  const endpoints = [
    `${FEISHU_BASE_URL}/open-apis/doc/v2/${document.objToken}/raw_content`,
    `${FEISHU_BASE_URL}/open-apis/doc/v2/documents/${document.objToken}/raw_content`
  ];
  let lastError;

  for (const url of endpoints) {
    try {
      return extractRawContent(await fetchFeishuJson({
        fetchImpl,
        url,
        headers: feishuAuthHeaders(tenantAccessToken)
      }));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("旧版飞书文档读取失败");
}

async function writeFeishuSignalFile({ resource, document, days, dataDir, now }) {
  const sourceDir = join(dataDir, "sources");
  await mkdir(sourceDir, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const token = document.wikiToken || document.objToken || resource.token;
  const outputPath = join(sourceDir, `feishu-signals-${date}-${safeSlug(token).slice(0, 12)}.json`);

  await writeFile(
    outputPath,
    JSON.stringify({
      source: "feishu",
      importedAt: now.toISOString(),
      title: document.title || "飞书社群信号",
      url: resource.url,
      resource: {
        kind: resource.kind,
        token: resource.token,
        objType: document.objType,
        objToken: document.objToken,
        wikiToken: document.wikiToken,
        spaceId: document.spaceId,
        nodeToken: document.nodeToken
      },
      days
    }, null, 2),
    "utf8"
  );

  return outputPath;
}

function extractRawContent(json) {
  const value = json.data?.content ?? json.content ?? json.data?.text ?? json.text ?? "";
  return normalizeText(value);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanToken(value) {
  return String(value || "").trim().replace(/[?#].*$/, "");
}

function safeSlug(value) {
  return String(value || "source").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "source";
}
