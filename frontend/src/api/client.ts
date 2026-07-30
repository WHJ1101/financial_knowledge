/**
 * 极简 API 客户端（方案 §8.3）。
 * 同源 /api/v1；写请求自动带 CSRF（double-submit，方案 §9.2）：从 fk_csrf cookie 读回填。
 * M9 起步手写；OpenAPI 类型生成在页面铺开后接入。
 */

const BASE = "/api/v1";
const CSRF_COOKIE = "fk_csrf";
const CSRF_FAILURE = "CSRF 校验失败";

let csrfRefreshPromise: Promise<string> | null = null;

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

async function responseError(resp: Response, method: string, path: string): Promise<ApiError> {
  let detail = `${method} ${path} failed (${resp.status})`;
  try {
    const data = await resp.json();
    if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    /* 非 JSON 错误体，用默认 detail */
  }
  return new ApiError(resp.status, detail);
}

async function refreshCsrf(): Promise<string> {
  if (!csrfRefreshPromise) {
    csrfRefreshPromise = (async () => {
      const resp = await fetch(`${BASE}/auth/csrf`, { credentials: "same-origin" });
      if (!resp.ok) throw await responseError(resp, "GET", "/auth/csrf");
      const data = (await resp.json()) as { csrf_token?: unknown };
      if (typeof data.csrf_token !== "string" || !data.csrf_token) {
        throw new ApiError(502, "CSRF token 响应无效");
      }
      return data.csrf_token;
    })().finally(() => {
      csrfRefreshPromise = null;
    });
  }
  return csrfRefreshPromise;
}

async function send<T>(
  method: string,
  path: string,
  body: unknown,
  csrf: string | null,
  canRefreshCsrf: boolean,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {};
  const opts: RequestInit = { method, headers, credentials: "same-origin", signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET" && csrf) headers["X-CSRF-Token"] = csrf;

  const resp = await fetch(`${BASE}${path}`, opts);
  if (!resp.ok) {
    const error = await responseError(resp, method, path);
    // 服务端在校验阶段已经拒绝了请求，可以安全续签并仅重试一次。
    if (method !== "GET" && canRefreshCsrf && error.status === 403 && error.detail === CSRF_FAILURE) {
      return send<T>(method, path, body, await refreshCsrf(), false, signal);
    }
    throw error;
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let csrf: string | null = null;
  if (method !== "GET") {
    csrf = readCookie(CSRF_COOKIE);
    if (!csrf) csrf = await refreshCsrf();
  }
  return send<T>(method, path, body, csrf, true, signal);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** 登录/注册前先取 CSRF token（种下 fk_csrf cookie，方案 §9.2）。 */
export async function ensureCsrf(): Promise<void> {
  await refreshCsrf();
}
