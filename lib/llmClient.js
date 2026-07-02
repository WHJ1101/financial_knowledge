// 统一的 LLM 客户端配置与调用。
// 之前 researchPipeline / communitySignalPipeline / stock-analyzer 各自重复实现了
// resolveLlmUrl、API key/model 三选一、以及 OpenAI 兼容的 chat/completions 调用，这里收敛。

import { fetchJsonWithTimeout } from "./http.js";

const DEFAULT_LLM_TIMEOUT_MS = 30000;

// 解析 API key：FINANCE_KNOWLEDGE_LLM_API_KEY > LLM_API_KEY > OPENAI_API_KEY。
export function resolveLlmApiKey() {
  return process.env.FINANCE_KNOWLEDGE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
}

// 解析模型名：FINANCE_KNOWLEDGE_LLM_MODEL > LLM_MODEL > OPENAI_MODEL > gpt-4o-mini。
export function resolveLlmModel() {
  return process.env.FINANCE_KNOWLEDGE_LLM_MODEL || process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

// 解析接口地址：显式 URL 优先，其次 OPENAI_BASE_URL 拼接，最后在有 key 时回退到 OpenAI 官方端点。
export function resolveLlmUrl() {
  if (process.env.FINANCE_KNOWLEDGE_LLM_API_URL) return process.env.FINANCE_KNOWLEDGE_LLM_API_URL;
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  if (process.env.OPENAI_BASE_URL) return `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  if (resolveLlmApiKey()) return "https://api.openai.com/v1/chat/completions";
  return "";
}

// 是否已配置可用的 LLM（有接口地址或密钥）。
export function isLlmConfigured() {
  return Boolean(resolveLlmUrl() || resolveLlmApiKey());
}

// 调用 OpenAI 兼容的 chat/completions 接口，返回原始 JSON 响应。
// 未配置时抛错；网络/超时错误由 fetchJsonWithTimeout 抛出，调用方自行降级。
export async function callChatCompletion({ messages, model = resolveLlmModel(), temperature = 0.3, responseFormat = { type: "json_object" }, timeout = DEFAULT_LLM_TIMEOUT_MS, fetchImpl } = {}) {
  const apiUrl = resolveLlmUrl();
  const apiKey = resolveLlmApiKey();
  if (!apiUrl && !apiKey) throw new Error("未配置 LLM_API_KEY 或 LLM_API_URL");

  const body = { model, messages, temperature };
  if (responseFormat) body.response_format = responseFormat;

  return fetchJsonWithTimeout(apiUrl, {
    fetchImpl,
    timeout,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(body)
  });
}

// 从 chat/completions 响应中取出文本内容，兼容 output_text 与整体回退。
export function extractContent(response) {
  return response?.choices?.[0]?.message?.content || response?.output_text || JSON.stringify(response);
}

// 容错解析模型返回的 JSON：先去 ``` 代码围栏，失败后再截取首个 {...}。
export function parseLlmJson(content) {
  const raw = String(content || "").trim();
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error("模型返回内容不是有效 JSON");
  }
}
