import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "fk_session";
const SESSION_TTL_SECONDS = Number(process.env.FINANCE_KNOWLEDGE_SESSION_TTL_SECONDS || 7 * 24 * 60 * 60);

function authConfig() {
  const password = process.env.FINANCE_KNOWLEDGE_AUTH_PASSWORD || process.env.AUTH_PASSWORD || "";
  return {
    required: process.env.FINANCE_KNOWLEDGE_AUTH_REQUIRED === "true" || Boolean(password),
    configured: Boolean(password),
    username: process.env.FINANCE_KNOWLEDGE_AUTH_USERNAME || process.env.AUTH_USERNAME || "admin",
    password,
    secret:
      process.env.FINANCE_KNOWLEDGE_AUTH_SECRET ||
      process.env.AUTH_SECRET ||
      (password ? `${password}:financial-knowledge` : randomBytes(32).toString("hex")),
    importToken: process.env.FINANCE_KNOWLEDGE_IMPORT_TOKEN || process.env.REPORT_IMPORT_TOKEN || ""
  };
}

export function getAuthSession(req) {
  const config = authConfig();
  if (!config.required) return { authenticated: true, user: null, authRequired: false, configured: true };
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  const payload = verifySessionToken(token, config.secret);
  return {
    authenticated: Boolean(payload),
    user: payload?.u || null,
    authRequired: true,
    configured: config.configured
  };
}

export function isAuthenticated(req) {
  return getAuthSession(req).authenticated;
}

export function canImportReport(req) {
  const config = authConfig();
  if (!config.required) return true;
  if (isAuthenticated(req)) return true;
  if (!config.importToken) return false;
  const token = getBearerToken(req) || req.headers["x-import-token"] || "";
  return safeEqual(token, config.importToken);
}

export function login(body) {
  const config = authConfig();
  if (!config.required) return { ok: true, user: null, cookie: clearCookieHeader() };
  if (!config.configured) return { ok: false, statusCode: 503, error: "登录尚未配置，请先设置 AUTH_PASSWORD" };

  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!safeEqual(username, config.username) || !safeEqual(password, config.password)) {
    return { ok: false, statusCode: 401, error: "用户名或密码错误" };
  }

  return {
    ok: true,
    user: username,
    cookie: sessionCookieHeader(createSessionToken(username, config.secret))
  };
}

export function logoutCookie() {
  return clearCookieHeader();
}

function createSessionToken(user, secret) {
  const payload = {
    u: user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const data = base64url(JSON.stringify(payload));
  const sig = sign(data, secret);
  return `${data}.${sig}`;
}

function verifySessionToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!safeEqual(sig, sign(data, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(data, secret) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function sessionCookieHeader(token) {
  return serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

function clearCookieHeader() {
  return serializeCookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
