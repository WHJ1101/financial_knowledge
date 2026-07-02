// 统一的 HTTP 工具：带超时的 fetch + JSON 解析。
// 之前 researchPipeline / communitySignalPipeline / dailyMarketBriefingPipeline / stock-analyzer
// 各自实现了几乎相同的超时封装，这里收敛为单一实现。

export const DEFAULT_HTTP_TIMEOUT_MS = 8000;

// 带超时的 fetch，超时后 abort。返回原始 Response。
export async function fetchWithTimeout(url, { fetchImpl = globalThis.fetch, timeout = DEFAULT_HTTP_TIMEOUT_MS, ...options } = {}) {
  if (!fetchImpl) throw new Error("fetch is unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 带超时的 fetch 并解析为 JSON。
// options.tolerant 为 true 时，非 JSON 响应体降级为 { title: url, content: text } 而非抛错，
// 供数据源采集这类"尽力而为"的场景使用。
export async function fetchJsonWithTimeout(url, { tolerant = false, ...options } = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  try {
    return JSON.parse(text);
  } catch (err) {
    if (tolerant) return { title: url, content: text };
    throw err;
  }
}
