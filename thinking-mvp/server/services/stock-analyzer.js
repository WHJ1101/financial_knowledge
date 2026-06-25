import db from "./db.js";
import { searchStocks, getStockQuote } from "./market-data.js";

const HTTP_TIMEOUT_MS = 30000;

function resolveLlmUrl() {
  if (process.env.FINANCE_KNOWLEDGE_LLM_API_URL) return process.env.FINANCE_KNOWLEDGE_LLM_API_URL;
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  if (process.env.OPENAI_BASE_URL) return `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  if (process.env.FINANCE_KNOWLEDGE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) return "https://api.openai.com/v1/chat/completions";
  return "";
}

async function callLlm(messages) {
  const apiUrl = resolveLlmUrl();
  const apiKey = process.env.FINANCE_KNOWLEDGE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.FINANCE_KNOWLEDGE_LLM_MODEL || process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiUrl && !apiKey) throw new Error("未配置 LLM_API_KEY 或 LLM_API_URL");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages, temperature: 0.3, response_format: { type: "json_object" } }),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    return JSON.parse(data.choices[0].message.content);
  } finally { clearTimeout(timeout); }
}

export async function analyzeStock(code, name, market) {
  db.prepare("UPDATE stocks SET analysis_status='analyzing' WHERE code=?").run(code);
  try {
    const result = await callLlm([
      { role: "system", content: "你是投研分析助手。根据给定股票信息生成投资分析，只输出 JSON。" },
      { role: "user", content: JSON.stringify({
        code, name, market,
        requiredJson: { thesis: "关注理由(string)", advice: "操作建议(string)", risk: "风险提示(string)", watchSignals: ["跟踪信号数组"] }
      }) }
    ]);
    db.prepare("UPDATE stocks SET thesis=?, advice=?, risk=?, watch_signals=?, analysis_status='done', updated_at=? WHERE code=?").run(
      result.thesis || "", result.advice || "", result.risk || "",
      JSON.stringify(result.watchSignals || []), new Date().toISOString(), code
    );
  } catch (e) {
    console.error(`Stock analysis failed [${code}]:`, e.message);
    db.prepare("UPDATE stocks SET analysis_status='failed' WHERE code=?").run(code);
  }
}

export async function analyzePosition(id, code, name, market) {
  db.prepare("UPDATE positions SET analysis_status='analyzing' WHERE id=?").run(id);
  try {
    const row = db.prepare("SELECT shares, cost FROM positions WHERE id=?").get(id);
    const shares = row?.shares || 0;
    const cost = row?.cost || 0;

    // 获取实时行情
    let quote = null;
    try {
      const searchResults = await searchStocks(code);
      const match = searchResults.find(s => s.code === code);
      if (match) quote = await getStockQuote(match.secid);
    } catch {}

    const currentPrice = quote?.price || null;
    const pnlPct = (currentPrice && cost) ? (((currentPrice - cost) / cost) * 100).toFixed(2) : null;

    const result = await callLlm([
      { role: "system", content: "你是专业投资顾问。根据用户的持仓信息和当前行情，给出具体的操作决策建议。只输出 JSON。" },
      { role: "user", content: JSON.stringify({
        code, name, market, shares, cost,
        currentPrice, changePct: quote?.changePct, high: quote?.high, low: quote?.low, open: quote?.open,
        pnlPct: pnlPct ? `${pnlPct}%` : "未知",
        requiredJson: {
          action: "操作建议：加仓/减仓/持有/止盈/止损(string)",
          reason: "决策理由，结合成本、当前价、盈亏比和市场趋势分析(string)",
          risk: "风险提示(string)"
        }
      }) }
    ]);
    db.prepare("UPDATE positions SET reason=?, risk=?, analysis_status='done', updated_at=? WHERE id=?").run(
      `【${result.action || "持有"}】${result.reason || ""}`, result.risk || "", new Date().toISOString(), id
    );
  } catch (e) {
    console.error(`Position analysis failed [${id}]:`, e.message);
    db.prepare("UPDATE positions SET analysis_status='failed' WHERE id=?").run(id);
  }
}
