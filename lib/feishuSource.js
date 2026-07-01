import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FEISHU_BASE_URL = "https://open.feishu.cn";
const DEFAULT_TIMEOUT_MS = Number(process.env.FEISHU_API_TIMEOUT_MS || 10000);
const DEFAULT_CHUNK_SIZE = Number(process.env.FEISHU_SIGNAL_CHUNK_SIZE || 4500);

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
  const items = buildFeishuSignalRecords({ resource, document, content, now });
  const outputPath = await writeFeishuSignalFile({ resource, document, items, dataDir, now });

  return {
    outputPath,
    title: document.title || "飞书社群信号",
    resource,
    document,
    items,
    itemCount: items.length,
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

export function buildFeishuSignalRecords({ resource, document, content, now = new Date() }) {
  const normalizedContent = normalizeText(content);
  if (!normalizedContent) throw new Error("飞书文档内容为空");

  const title = document.title || "飞书社群信号";
  const chunks = chunkText(normalizedContent, DEFAULT_CHUNK_SIZE);
  const importedAt = now.toISOString();

  return chunks.map((chunk, index) => ({
    title: chunks.length > 1 ? `飞书社群信号：${title} #${index + 1}` : `飞书社群信号：${title}`,
    dataset: "feishu-signal",
    type: "社群信号",
    category: "财经社群信号",
    source: "飞书知识库",
    url: resource.url,
    observedAt: importedAt,
    confidence: "medium",
    content: chunk,
    metadata: {
      importedAt,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      objType: document.objType,
      objToken: document.objToken,
      wikiToken: document.wikiToken || resource.token
    }
  }));
}

async function getTenantAccessToken({ appId, appSecret, fetchImpl }) {
  const json = await fetchFeishuJson({
    fetchImpl,
    url: `${FEISHU_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`,
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });

  const token = json.tenant_access_token || json.data?.tenant_access_token;
  if (!token) throw new Error("飞书未返回 tenant_access_token");
  return token;
}

async function getWikiNode({ wikiToken, tenantAccessToken, fetchImpl }) {
  const url = new URL(`${FEISHU_BASE_URL}/open-apis/wiki/v2/spaces/get_node`);
  url.searchParams.set("token", wikiToken);
  const json = await fetchFeishuJson({
    fetchImpl,
    url,
    headers: authHeaders(tenantAccessToken)
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
      headers: authHeaders(tenantAccessToken)
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
        headers: authHeaders(tenantAccessToken)
      }));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("旧版飞书文档读取失败");
}

async function writeFeishuSignalFile({ resource, document, items, dataDir, now }) {
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
      items
    }, null, 2),
    "utf8"
  );

  return outputPath;
}

async function fetchFeishuJson({
  fetchImpl,
  url,
  method = "GET",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(`飞书 HTTP ${response.status}: ${shortError(json.msg || json.message || text)}`);
    }

    const code = Number(json.code ?? 0);
    if (code !== 0) {
      throw new Error(`飞书 API ${code}: ${shortError(json.msg || json.message || json.error || text)}`);
    }

    return json;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`飞书 API 超时：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function extractRawContent(json) {
  const value = json.data?.content ?? json.content ?? json.data?.text ?? json.text ?? "";
  return normalizeText(value);
}

function chunkText(text, maxLength) {
  const paragraphs = normalizeText(text).split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if (current && `${current}\n\n${paragraph}`.length > maxLength) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length > maxLength) {
      chunks.push(...paragraph.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, "g")));
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [normalizeText(text).slice(0, maxLength)];
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

function shortError(value) {
  return String(value || "未知错误").slice(0, 300);
}
