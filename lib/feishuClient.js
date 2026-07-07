// 飞书开放平台通用底座：tenant_access_token 获取（带内存缓存）+ 通用 JSON 请求。
// 之前 feishuSource.js 内部各自实现了取 token / fetch 封装，这里收敛为单一实现，
// 供社群信号采集（feishuSource.js）与消息推送（feishuBot.js）共用。
export const FEISHU_BASE_URL = "https://open.feishu.cn";

const DEFAULT_TIMEOUT_MS = Number(process.env.FEISHU_API_TIMEOUT_MS || 10000);
const DEFAULT_TOKEN_TTL_SEC = 7200; // 飞书 tenant_access_token 默认有效期
const TOKEN_REFRESH_BUFFER_SEC = 300; // 提前 5 分钟视为过期，避免临界失效

// key = appId，value = { token, expiresAt(ms) }。进程级缓存，跨调用复用，减少换 token 请求。
const tokenCache = new Map();

// 是否已配置飞书应用凭证（appId + secret）。
export function isFeishuConfigured() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

// 获取 tenant_access_token，命中未过期缓存则直接返回。now 可注入便于测试过期逻辑。
export async function getTenantAccessToken({
  appId = process.env.FEISHU_APP_ID,
  appSecret = process.env.FEISHU_APP_SECRET,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  forceRefresh = false
} = {}) {
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET");

  const currentMs = typeof now === "number" ? now : now?.getTime?.() ?? Date.now();
  const cached = tokenCache.get(appId);
  if (!forceRefresh && cached && cached.expiresAt > currentMs) return cached.token;

  const json = await fetchFeishuJson({
    fetchImpl,
    url: `${FEISHU_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`,
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });

  const token = json.tenant_access_token || json.data?.tenant_access_token;
  if (!token) throw new Error("飞书未返回 tenant_access_token");

  const expireSec = Number(json.expire ?? json.data?.expire) || DEFAULT_TOKEN_TTL_SEC;
  tokenCache.set(appId, { token, expiresAt: currentMs + Math.max(60, expireSec - TOKEN_REFRESH_BUFFER_SEC) * 1000 });
  return token;
}

// 清空 token 缓存（供测试隔离用例，避免跨用例复用旧 token）。
export function resetFeishuClientCache() {
  tokenCache.clear();
}

export function feishuAuthHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

// 通用飞书 JSON 请求：带超时；HTTP 非 2xx 或业务 code!==0 均抛错。
export async function fetchFeishuJson({
  fetchImpl = globalThis.fetch,
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

function shortError(value) {
  return String(value || "未知错误").slice(0, 300);
}
