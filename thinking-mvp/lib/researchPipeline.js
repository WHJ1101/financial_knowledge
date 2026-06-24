import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const MAX_EVIDENCE_ITEMS = 12;
const HTTP_TIMEOUT_MS = Number(process.env.DATA_SOURCE_TIMEOUT_MS || 8000);

export async function runResearchPipeline({
  topic,
  type,
  previousReports = [],
  dataDir,
  now = new Date()
}) {
  const evidence = await collectEvidence({ topic, type, previousReports, dataDir });
  let llm = await callConfiguredLlm({ topic, type, evidence, now });
  let brief;

  if (llm.ok) {
    try {
      brief = normalizeLlmBrief(parseLlmJson(llm.content), evidence);
    } catch (error) {
      llm = {
        ...llm,
        ok: false,
        error: `模型结果解析失败：${String(error.message || error).slice(0, 280)}`
      };
      brief = buildEvidenceBasedDraft({ topic, type, evidence, llm });
    }
  } else {
    brief = buildEvidenceBasedDraft({ topic, type, evidence, llm });
  }

  return {
    ...brief,
    tags: mergeTags(brief.tags, deriveTags(topic, type)),
    evidence,
    dataQuality: buildDataQuality(evidence, llm)
  };
}

async function collectEvidence({ topic, type, previousReports, dataDir }) {
  const results = await Promise.all([
    collectLocalSourceFiles({ topic, type, dataDir }),
    collectHttpSources({ topic, type }),
    collectReportHistory({ topic, type, previousReports })
  ]);

  return dedupeEvidence(results.flat())
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_ITEMS);
}

async function collectLocalSourceFiles({ topic, type, dataDir }) {
  const sourceDir = process.env.DATA_SOURCE_DIR || join(dataDir, "sources");
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json")
    .slice(0, 24);
  const evidence = [];

  for (const file of jsonFiles) {
    const filePath = join(sourceDir, file.name);
    try {
      const json = JSON.parse(await readFile(filePath, "utf8"));
      const records = expandRecords(json).map((record, index) =>
        normalizeRecord({
          record,
          source: `本地数据源：${file.name}`,
          fallbackTitle: `${basename(file.name, ".json")} #${index + 1}`
        })
      );
      const matching = filterMatchingRecords(records, topic, type);
      evidence.push(...matching);
    } catch (error) {
      evidence.push({
        source: `本地数据源：${file.name}`,
        title: `${file.name} 读取失败`,
        observedAt: null,
        confidence: "low",
        excerpt: String(error.message || error).slice(0, 280)
      });
    }
  }

  return evidence;
}

async function collectHttpSources({ topic, type }) {
  const urls = String(process.env.DATA_SOURCE_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  if (!urls.length) return [];

  const results = [];
  for (const rawUrl of urls.slice(0, 6)) {
    try {
      const url = buildSourceUrl(rawUrl, topic, type);
      const data = await fetchJsonWithTimeout(url);
      const records = expandRecords(data).map((record, index) =>
        normalizeRecord({
          record,
          source: `在线数据源：${rawUrl}`,
          fallbackTitle: `在线数据源 #${index + 1}`
        })
      );
      results.push(...filterMatchingRecords(records, topic, type));
    } catch (error) {
      results.push({
        source: `在线数据源：${rawUrl}`,
        title: "在线数据源读取失败",
        url: rawUrl,
        observedAt: null,
        confidence: "low",
        excerpt: String(error.message || error).slice(0, 280)
      });
    }
  }

  return results;
}

function collectReportHistory({ topic, type, previousReports }) {
  const terms = topicTerms(topic, type);
  return previousReports
    .filter((report) => report.type === type || matchesTerms(reportToText(report), terms))
    .slice(0, 5)
    .map((report) => ({
      source: "历史报告",
      title: report.title,
      url: `/reports/${report.file}`,
      observedAt: report.createdAt,
      confidence: "medium",
      excerpt: report.summary || (report.highlights || []).join("；")
    }));
}

async function callConfiguredLlm({ topic, type, evidence, now }) {
  const apiUrl = resolveLlmUrl();
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiUrl && !apiKey) {
    return {
      enabled: false,
      ok: false,
      model,
      error: "未配置模型接口地址或密钥"
    };
  }

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是金融与产业研究助理。只输出 JSON，不输出 Markdown。结论必须基于给定 evidence，不能编造外部事实。"
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "基于证据生成一份可落盘网页报告的中文研究简报。",
            requiredJsonShape: {
              summary: "string",
              highlights: ["string"],
              watchList: ["string"],
              risks: ["string"],
              nextSteps: ["string"],
              tags: ["string"]
            },
            topic,
            type,
            generatedAt: now.toISOString(),
            evidence: evidence.map(compactEvidence)
          },
          null,
          2
        )
      }
    ],
    temperature: Number(process.env.LLM_TEMPERATURE || 0.2)
  };

  if ((process.env.LLM_RESPONSE_FORMAT || "json_object") === "json_object") {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetchJsonWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    });

    return {
      enabled: true,
      ok: true,
      model,
      content:
        response.choices?.[0]?.message?.content ||
        response.output_text ||
        JSON.stringify(response)
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      model,
      error: String(error.message || error).slice(0, 500)
    };
  }
}

function buildEvidenceBasedDraft({ topic, type, evidence, llm }) {
  const focus = focusWords(type);
  const sourceTitles = evidence.map((item) => item.title).filter(Boolean).slice(0, 3);
  const sourceText = sourceTitles.length ? `已采集 ${evidence.length} 条证据，重点包括：${sourceTitles.join("、")}。` : "尚未配置外部数据源，当前仅能形成研究任务草稿。";

  return {
    summary: `${topic} 已进入数据源采集与模型研究流程。${sourceText}${
      llm.enabled ? `模型调用未完成：${llm.error}` : "配置模型密钥或接口地址后可启用模型深度分析。"
    }`,
    highlights: [
      evidence.length
        ? `证据层已从 ${unique(evidence.map((item) => item.source)).join("、")} 汇总信息，需要继续校验来源时间与覆盖度。`
        : "数据层尚未接入，当前报告不应作为投资结论使用。",
      `${focus[0]} 是本次调研的第一观察维度，应优先补齐可复核数据。`,
      `${focus[1]} 需要和历史区间、同业比较或政策节奏放在一起看。`
    ],
    watchList: [
      `补充 ${topic} 的高频数据、公告、新闻或研报摘要。`,
      "把每条新增证据记录为本地数据源文件，保留来源、时间和可信度。",
      "配置模型后复跑同一主题，对比模型结论和证据是否一致。"
    ],
    risks: [
      "证据覆盖不足时，模型容易把研究框架误写成确定结论。",
      "外部数据源若缺少时间戳，无法判断信息是否过期。",
      "市场主题交易拥挤时，产业逻辑和短线价格可能明显背离。"
    ],
    nextSteps: [
      "配置本地数据源目录，放入行情、公告、新闻或自有研究文件。",
      "配置模型密钥、接口地址和模型名称，启用模型分析。",
      "为日更任务拆分固定数据源：市场、政策、产业链、股票池。"
    ],
    tags: deriveTags(topic, type)
  };
}

function normalizeLlmBrief(value, evidence) {
  return {
    summary: stringOrFallback(value.summary, "模型已生成研究摘要，但返回内容缺少摘要字段。"),
    highlights: normalizeTextArray(value.highlights, evidence, "核心观察"),
    watchList: normalizeTextArray(value.watchList, evidence, "跟踪清单"),
    risks: normalizeTextArray(value.risks, evidence, "风险与反证"),
    nextSteps: normalizeTextArray(value.nextSteps, evidence, "下一步"),
    tags: normalizeStringArray(value.tags).slice(0, 8)
  };
}

function normalizeTextArray(value, evidence, label) {
  const normalized = normalizeStringArray(value).slice(0, 6);
  if (normalized.length) return normalized;
  return [`${label} 待补充。当前已采集 ${evidence.length} 条证据。`];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function stringOrFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function parseLlmJson(content) {
  const raw = String(content || "").trim();
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("模型返回内容不是有效 JSON");
  }
}

function buildDataQuality(evidence, llm) {
  return [
    { name: "本地报告落盘", status: "正常" },
    {
      name: "数据源采集",
      status: evidence.length ? `正常 · ${evidence.length} 条` : "待配置 · 未发现数据源"
    },
    {
      name: "模型深度分析",
      status: llm.ok
        ? `正常 · ${llm.model}`
        : llm.enabled
          ? `失败 · ${llm.error}`
          : "待配置 · 未配置"
    },
    {
      name: "证据引用",
      status: evidence.length ? "正常" : "待配置"
    }
  ];
}

function expandRecords(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.records)) return data.records;
  if (Array.isArray(data.data)) return data.data;
  return [data];
}

function normalizeRecord({ record, source, fallbackTitle }) {
  const title = record.title || record.name || record.symbol || record.code || fallbackTitle;
  const excerpt =
    record.summary ||
    record.excerpt ||
    record.description ||
    record.content ||
    compactJson(record, 700);

  return {
    source,
    title: String(title),
    url: record.url || record.link || null,
    observedAt: record.observedAt || record.publishedAt || record.date || record.updatedAt || null,
    confidence: record.confidence || record.quality || "medium",
    excerpt: String(excerpt).slice(0, 900)
  };
}

function filterMatchingRecords(records, topic, type) {
  const terms = topicTerms(topic, type);
  const matching = records.filter((record) => matchesTerms(evidenceToText(record), terms));
  return (matching.length ? matching : records).slice(0, 8);
}

function topicTerms(topic, type) {
  const matches = String(topic).match(/[\p{L}\p{N}]{2,}/gu) || [];
  return unique([type, ...matches]).map((term) => term.toLowerCase());
}

function matchesTerms(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function reportToText(report) {
  return [report.title, report.topic, report.summary, ...(report.tags || [])].join(" ");
}

function evidenceToText(evidence) {
  return [evidence.title, evidence.excerpt, evidence.source].join(" ");
}

function compactEvidence(item) {
  return {
    source: item.source,
    title: item.title,
    observedAt: item.observedAt,
    confidence: item.confidence,
    excerpt: item.excerpt
  };
}

function compactJson(value, maxLength) {
  return JSON.stringify(value, null, 2).slice(0, maxLength);
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}|${item.title}|${item.observedAt || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveTags(topic, type) {
  const dictionary = [
    "AI",
    "算力",
    "光模块",
    "半导体",
    "锗",
    "InP",
    "低空经济",
    "政策",
    "A股",
    "美股",
    "ETF",
    "财报",
    "产业链",
    "材料",
    "机器人",
    "液冷"
  ];
  const matches = dictionary.filter((word) => topic.toLowerCase().includes(word.toLowerCase()));
  const fallback = {
    industry: "产业链",
    market: "市场",
    stock: "个股",
    policy: "政策",
    custom: "研究"
  }[type];
  return mergeTags([fallback], matches).slice(0, 8);
}

function mergeTags(...tagGroups) {
  return unique(tagGroups.flat().map((tag) => String(tag || "").trim()).filter(Boolean));
}

function unique(values) {
  return [...new Set(values)];
}

function focusWords(type) {
  return {
    industry: ["供需位置", "订单验证", "国产替代"],
    market: ["指数结构", "成交额", "风格轮动"],
    stock: ["业绩兑现", "估值锚", "催化事件"],
    policy: ["政策方向", "落地节奏", "受益环节"],
    custom: ["核心假设", "证据链", "关键变量"]
  }[type] || ["核心假设", "证据链", "关键变量"];
}

function resolveLlmUrl() {
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  if (process.env.OPENAI_BASE_URL) {
    return `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  }
  if (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) {
    return "https://api.openai.com/v1/chat/completions";
  }
  return "";
}

function buildSourceUrl(rawUrl, topic, type) {
  const replaced = rawUrl
    .replaceAll("{topic}", encodeURIComponent(topic))
    .replaceAll("{type}", encodeURIComponent(type));
  if (replaced !== rawUrl || /[?&]topic=/.test(replaced)) return replaced;

  const url = new URL(replaced);
  url.searchParams.set("topic", topic);
  url.searchParams.set("type", type);
  return url.toString();
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { title: url, content: text };
    }
  } finally {
    clearTimeout(timeout);
  }
}
