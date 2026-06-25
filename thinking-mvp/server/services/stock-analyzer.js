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
    // 获取实时行情作为分析依据
    let quote = null;
    try {
      const searchResults = await searchStocks(code);
      const match = searchResults.find(s => s.code === code);
      if (match) quote = await getStockQuote(match.secid);
    } catch {}

    const result = await callLlm([
      { role: "system", content: `你是一位采用产业链瓶颈分析方法的投研分析师。分析标的时必须回答：
1. 它在产业链中卡住什么环节？（不是泛泛说"行业前景好"）
2. 为什么这个环节有稀缺性？（供应商集中度、扩产难度、认证壁垒、良率瓶颈）
3. 什么事件会让市场重新定价？（订单、产能、客户认证、政策）
4. 什么事实能证伪这个逻辑？（替代路线、需求不及预期、竞争格局恶化）

禁止使用套话（如"前景广阔""值得关注""建议适时布局"）。每条结论必须对应具体的产业逻辑或可验证事实。
只输出 JSON。` },
      { role: "user", content: JSON.stringify({
        code, name, market,
        currentPrice: quote?.price || null,
        changePct: quote?.changePct || null,
        requiredJson: {
          thesis: "关注理由：必须说明该公司卡住产业链哪个环节、为什么有稀缺性(string)",
          advice: "操作建议：含具体触发条件，如'若Q3订单确认超预期则加仓'(string)",
          risk: "证伪条件：什么事实会让这个逻辑失效(string)",
          watchSignals: ["需要跟踪验证的具体信号，如客户认证进度、产能利用率、订单确认等"]
        }
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
      { role: "system", content: `你是采用产业链瓶颈分析方法的持仓顾问。给出操作建议时必须：
1. 结合当前价格相对成本的位置（盈亏比），判断风险收益是否对称
2. 判断当前价格是否反映了已知利好/利空，是否存在预期差
3. 给出明确动作和触发条件，不说"建议观察""适时操作"这类废话
4. 风险提示必须是具体的证伪条件，不是"市场波动可能导致下跌"

只输出 JSON。` },
      { role: "user", content: JSON.stringify({
        code, name, market, shares, cost,
        currentPrice, changePct: quote?.changePct, high: quote?.high, low: quote?.low, open: quote?.open,
        pnlPct: pnlPct ? `${pnlPct}%` : "未知",
        requiredJson: {
          action: "操作建议：加仓/减仓/持有/止盈/止损(string)",
          reason: "决策理由：必须包含盈亏位置分析、当前价格反映的预期、以及触发动作的具体条件(string)",
          risk: "证伪条件：什么具体事实出现则应立即止损或改变策略(string)"
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
