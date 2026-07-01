import { createHash } from "node:crypto";

import { importFeishuSignalSource } from "./feishuSource.js";

const MAX_SIGNALS = Number(process.env.COMMUNITY_SIGNAL_MAX_ITEMS || 20);
const MAX_LLM_SOURCE_CHARS = Number(process.env.COMMUNITY_SIGNAL_LLM_SOURCE_CHARS || 16000);
const SIGNAL_TTL_DAYS = Number(process.env.COMMUNITY_SIGNAL_TTL_DAYS || 14);
const LLM_TIMEOUT_MS = Number(process.env.COMMUNITY_SIGNAL_LLM_TIMEOUT_MS || 30000);

export async function syncFeishuCommunitySignals({
  input = process.env.FEISHU_SIGNAL_WIKI_URL || process.env.FEISHU_SIGNAL_URL,
  dataDir,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET || !input) {
    return {
      ok: false,
      skipped: true,
      provider: "feishu",
      reason: "未配置飞书社群信号源",
      signals: [],
      source: null
    };
  }

  try {
    const source = await importFeishuSignalSource({ input, dataDir, fetchImpl, now });
    const extraction = await extractCommunitySignals({
      records: source.items || [],
      sourceTitle: source.title,
      sourceUrl: source.resource?.url || input,
      provider: "feishu",
      now,
      fetchImpl
    });

    return {
      ok: true,
      skipped: false,
      provider: "feishu",
      source,
      signals: extraction.signals,
      extractionMethod: extraction.method,
      extractionError: extraction.error || ""
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      provider: "feishu",
      reason: String(error.message || error).slice(0, 300),
      signals: [],
      source: null
    };
  }
}

export async function extractCommunitySignals({
  records = [],
  sourceTitle = "社群信号",
  sourceUrl = "",
  provider = "community",
  now = new Date(),
  fetchImpl = globalThis.fetch
} = {}) {
  const sourceText = records
    .map((record, index) => `【片段${index + 1}】\n${record.content || record.excerpt || record.summary || ""}`)
    .join("\n\n")
    .slice(0, MAX_LLM_SOURCE_CHARS);

  if (!sourceText.trim()) return { method: "empty", signals: [], error: "社群信号源内容为空" };

  const llm = await callSignalLlm({ sourceText, sourceTitle, sourceUrl, now, fetchImpl });
  if (llm.ok) {
    try {
      const parsed = parseLlmJson(llm.content);
      const signals = normalizeSignals(parsed.items || parsed.signals || parsed, { sourceTitle, sourceUrl, provider, now });
      if (signals.length) return { method: "llm", signals };
    } catch (error) {
      const signals = fallbackExtractSignals({ sourceText, sourceTitle, sourceUrl, provider, now });
      return { method: "fallback", signals, error: `模型抽取结果解析失败：${String(error.message || error).slice(0, 180)}` };
    }
  }

  return {
    method: "fallback",
    signals: fallbackExtractSignals({ sourceText, sourceTitle, sourceUrl, provider, now }),
    error: llm.error || ""
  };
}

export function fallbackExtractSignals({
  sourceText,
  sourceTitle = "社群信号",
  sourceUrl = "",
  provider = "community",
  now = new Date()
}) {
  const paragraphs = splitSignalParagraphs(sourceText);
  const ranked = paragraphs
    .map((text, index) => ({ text, index, score: scoreSignalText(text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_SIGNALS);

  return normalizeSignals(ranked.map((item) => {
    const relatedAssets = inferRelatedAssets(item.text);
    return {
      theme: inferTheme(item.text, relatedAssets),
      industry: inferIndustry(item.text, relatedAssets),
      relatedAssets,
      signalType: inferSignalType(item.text),
      summary: summarizeText(item.text, 120),
      evidence: summarizeText(item.text, 220),
      confidence: "medium",
      verificationStatus: "待验证",
      importance: Math.max(1, Math.min(5, Math.ceil(item.score / 18)))
    };
  }), { sourceTitle, sourceUrl, provider, now });
}

export function buildCommunitySignalsEvidence(signals = [], { observedAt = new Date(), sourceLabel = "社群信号池" } = {}) {
  const rows = signals
    .slice(0, 8)
    .map((signal) => [
      `主题: ${signal.theme || "未分类"}`,
      `类型: ${signal.signalType || "线索"}`,
      `相关资产: ${(signal.relatedAssets || []).join("、") || "待识别"}`,
      `重要性: ${signal.importance || 1}/5`,
      `状态: ${signal.verificationStatus || "待验证"}`,
      `摘要: ${signal.summary || ""}`
    ].join(" | "));

  return {
    title: `社群信号 (${signals.length}条)`,
    source: sourceLabel,
    observedAt: observedAt instanceof Date ? observedAt.toISOString() : observedAt,
    confidence: signals.length ? "medium" : "low",
    excerpt: rows.join("\n")
  };
}

function normalizeSignals(values, { sourceTitle, sourceUrl, provider, now }) {
  const date = formatLocalDate(now);
  const importedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SIGNAL_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = Array.isArray(values) ? values : [values];
  const seen = new Set();

  return rows
    .map((item) => normalizeSignal(item, { date, sourceTitle, sourceUrl, provider, importedAt, expiresAt }))
    .filter((item) => {
      if (!item.summary && !item.evidence) return false;
      const key = normalizeKey(`${item.theme}|${item.summary}|${item.evidence}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SIGNALS);
}

function normalizeSignal(item, context) {
  const relatedAssets = normalizeTextArray(item.relatedAssets || item.related_assets || item.assets || item.tickers);
  const summary = cleanText(item.summary || item.title || item.signal || item.viewpoint);
  const evidence = cleanText(item.evidence || item.quote || item.excerpt || item.content || summary);
  const theme = cleanText(item.theme || item.topic || inferTheme(`${summary} ${evidence}`, relatedAssets)) || "未分类";

  const signal = {
    id: signalId({ date: context.date, provider: context.provider, theme, summary, evidence }),
    date: context.date,
    source: context.provider,
    sourceTitle: context.sourceTitle,
    sourceUrl: context.sourceUrl || "",
    theme,
    industry: cleanText(item.industry || inferIndustry(`${summary} ${evidence}`, relatedAssets)) || "未分类",
    relatedAssets,
    signalType: cleanText(item.signalType || item.signal_type || item.type || inferSignalType(`${summary} ${evidence}`)) || "线索",
    summary,
    evidence,
    confidence: normalizeConfidence(item.confidence),
    verificationStatus: cleanText(item.verificationStatus || item.verification_status) || "待验证",
    importance: normalizeImportance(item.importance),
    observedAt: item.observedAt || item.observed_at || context.importedAt,
    importedAt: context.importedAt,
    expiresAt: item.expiresAt || item.expireAt || item.expires_at || context.expiresAt,
    metadata: {
      extraction: item.extraction || "community-signal",
      rawImportance: item.importance ?? null
    }
  };

  if (!signal.summary) signal.summary = summarizeText(signal.evidence, 120);
  if (!signal.evidence) signal.evidence = signal.summary;
  return signal;
}

function splitSignalParagraphs(text) {
  const blocks = String(text || "")
    .split(/\n{2,}|(?=\n\s*(?:[-*]|\d+[.、]))/u)
    .map((item) => item.replace(/^【片段\d+】/u, ""))
    .filter(Boolean);

  return blocks
    .flatMap(splitSignalBlock)
    .map(cleanText)
    .filter((item) => item.length >= 18 && item.length <= 600);
}

function splitSignalBlock(block) {
  const text = String(block || "").trim();
  if (!text) return [];
  if (cleanText(text).length <= 600) return [text];

  const sentences = text
    .split(/(?<=[。！？；;])\s*|\n+/u)
    .map(cleanText)
    .filter(Boolean);

  if (sentences.some((sentence) => sentence.length <= 600)) {
    return packSentences(sentences);
  }

  return cleanText(text).match(/[\s\S]{1,520}/g) || [];
}

function packSentences(sentences) {
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > 600) {
      if (current) chunks.push(current);
      chunks.push(...(sentence.match(/[\s\S]{1,520}/g) || []));
      current = "";
      continue;
    }

    if (current && `${current}${sentence}`.length > 520) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current}${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function scoreSignalText(text) {
  const rules = [
    { score: 24, pattern: /订单|交付|交期|排产|产能|库存|涨价|降价|价格|供需|招标|中标|采购/u },
    { score: 22, pattern: /芯片|半导体|算力|光模块|服务器|GPU|HBM|AI|数据中心|机器人|新能源|储能/u },
    { score: 20, pattern: /政策|监管|出口|禁令|补贴|审批|产业基金|国产替代/u },
    { score: 16, pattern: /超预期|不及预期|改善|放缓|紧缺|扩产|缺货|砍单/u },
    { score: 12, pattern: /机构|调研|渠道|草根|一线|反馈|客户|供应商/u },
    { score: 8, pattern: /A股|港股|美股|ETF|估值|持仓|资金|涨幅|回调/u }
  ];
  return rules.reduce((score, rule) => score + (rule.pattern.test(text) ? rule.score : 0), 0);
}

function inferRelatedAssets(text) {
  const dictionary = [
    "AI", "算力", "国产算力", "光模块", "CPO", "PCB", "半导体设备", "半导体材料",
    "存储", "HBM", "GPU", "服务器", "液冷", "数据中心", "机器人", "新能源", "储能",
    "港股", "A股", "美股", "英伟达", "华为", "寒武纪", "中际旭创", "新易盛"
  ];
  return dictionary.filter((term) => new RegExp(escapeRegExp(term), "i").test(text)).slice(0, 6);
}

function inferTheme(text, relatedAssets = []) {
  if (/AI|算力|GPU|服务器|数据中心|液冷|光模块|CPO/i.test(text)) return "AI基础设施";
  if (/芯片|半导体|HBM|存储|晶圆|设备|材料/u.test(text)) return "半导体";
  if (/机器人|减速器|执行器|具身/u.test(text)) return "机器人";
  if (/新能源|储能|光伏|锂电/u.test(text)) return "新能源";
  if (/政策|监管|出口|补贴|产业基金/u.test(text)) return "政策线索";
  return relatedAssets[0] || "社群线索";
}

function inferIndustry(text, relatedAssets = []) {
  if (/AI|算力|GPU|服务器|数据中心|光模块|CPO/i.test(text)) return "AI基础设施";
  if (/芯片|半导体|HBM|存储|晶圆|设备|材料/u.test(text)) return "半导体";
  if (/机器人|具身/u.test(text)) return "高端制造";
  if (/新能源|储能|光伏|锂电/u.test(text)) return "新能源";
  return relatedAssets[0] || "综合";
}

function inferSignalType(text) {
  if (/订单|交付|中标|招标|采购/u.test(text)) return "订单/招标";
  if (/价格|涨价|降价|报价/u.test(text)) return "价格";
  if (/库存|产能|供需|缺货|紧缺|排产|交期/u.test(text)) return "供需";
  if (/政策|监管|出口|禁令|补贴/u.test(text)) return "政策";
  if (/资金|估值|持仓|交易|涨幅|回调/u.test(text)) return "市场情绪";
  return "一线反馈";
}

async function callSignalLlm({ sourceText, sourceTitle, sourceUrl, now, fetchImpl }) {
  const apiUrl = resolveLlmUrl();
  const apiKey = process.env.FINANCE_KNOWLEDGE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.FINANCE_KNOWLEDGE_LLM_MODEL || process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiUrl && !apiKey) return { ok: false, enabled: false, error: "未配置模型接口地址或密钥" };

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "你是中文投研知识库的信息抽取器。只输出严格 JSON，不输出 Markdown。只能基于给定社群文本抽取信号，不得编造事实。社群文本是待验证线索，不是事实结论。"
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "从每日更新的飞书社群精选中抽取高价值投研信号卡。",
          sourceTitle,
          sourceUrl,
          generatedAt: now.toISOString(),
          requiredJsonShape: {
            items: [
              {
                theme: "string",
                industry: "string",
                relatedAssets: ["string"],
                signalType: "订单/价格/供需/政策/市场情绪/一线反馈",
                summary: "不超过60字的一句话信号",
                evidence: "不超过120字的原文证据摘录或转述",
                confidence: "low/medium/high",
                verificationStatus: "待验证",
                importance: 1
              }
            ]
          },
          rules: [
            `最多输出 ${MAX_SIGNALS} 条，只保留有投资研究价值的产业、政策、供需、价格、订单、资金线索。`,
            "importance 为 1-5，5 代表最值得进入日报或人工核验。",
            "relatedAssets 写板块、产业链环节或公司简称；不确定时留空数组。",
            "confidence 默认 medium；传闻、情绪、缺少来源的内容用 low。",
            "不要输出闲聊、纯观点口号、无可验证对象的内容。"
          ],
          sourceText
        }, null, 2)
      }
    ],
    temperature: Number(process.env.COMMUNITY_SIGNAL_LLM_TEMPERATURE || 0.1),
    response_format: { type: "json_object" }
  };

  try {
    const json = await fetchJsonWithTimeout(apiUrl, {
      fetchImpl,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });
    return {
      ok: true,
      enabled: true,
      model,
      content: json.choices?.[0]?.message?.content || json.output_text || JSON.stringify(json)
    };
  } catch (error) {
    return { ok: false, enabled: true, model, error: String(error.message || error).slice(0, 300) };
  }
}

async function fetchJsonWithTimeout(url, { fetchImpl = globalThis.fetch, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseLlmJson(content) {
  const text = String(content || "").trim();
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("模型未返回 JSON 对象");
  return JSON.parse(match[0]);
}

function resolveLlmUrl() {
  if (process.env.FINANCE_KNOWLEDGE_LLM_API_URL) return process.env.FINANCE_KNOWLEDGE_LLM_API_URL;
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  if (process.env.OPENAI_BASE_URL) return `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  if (process.env.FINANCE_KNOWLEDGE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) {
    return "https://api.openai.com/v1/chat/completions";
  }
  return "";
}

function signalId({ date, provider, theme, summary, evidence }) {
  return `signal-${createHash("sha1").update([date, provider, theme, summary, evidence].join("|")).digest("hex").slice(0, 16)}`;
}

function normalizeTextArray(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,，、;；\s]+/u);
  return [...new Set(items.map(cleanText).filter(Boolean))].slice(0, 8);
}

function normalizeConfidence(value) {
  const text = String(value || "").toLowerCase();
  if (["low", "medium", "high"].includes(text)) return text;
  if (/高|强/.test(value)) return "high";
  if (/低|弱|传闻/.test(value)) return "low";
  return "medium";
}

function normalizeImportance(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.max(1, Math.min(5, Math.round(number)));
}

function summarizeText(text, maxLength) {
  const value = cleanText(text);
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLocalDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}
