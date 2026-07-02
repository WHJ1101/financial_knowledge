// 持仓录入的数量/成本推导。原先内联在 Portfolio.jsx，抽出后纯函数可单测。
import { formatMoney, formatNumber, formatQuoteHint } from "./format.js";

// 根据表单（金额/市值/数量/成本任意组合）与行情推导入库的 shares 与 cost。
// 返回 source 标记推导路径，blocked 表示需要先选中行情才能计算。
export function derivePositionNumbers(form, quote) {
  const amount = toPositiveNumber(form.amount);
  const marketValue = toPositiveNumber(form.marketValue);
  const shares = toPositiveNumber(form.shares);
  const cost = toPositiveNumber(form.cost);
  const price = toPositiveNumber(quote?.price);

  if (shares && cost) return { shares, cost, source: "detail" };
  if (amount && marketValue && price) {
    const estimatedShares = marketValue / price;
    return { shares: estimatedShares, cost: estimatedShares ? amount / estimatedShares : 0, source: "amount-market" };
  }
  if (amount && marketValue && !price) return { shares: 0, cost: 0, source: "amount-market", blocked: true };
  if (shares && amount) return { shares, cost: amount / shares, source: "mixed" };
  if (cost && amount) return { shares: amount / cost, cost, source: "mixed" };
  if (cost && marketValue && price) return { shares: marketValue / price, cost, source: "mixed" };
  if (shares) return { shares, cost: 0, source: "shares-only" };
  return { shares: 0, cost: 0, source: "empty" };
}

export function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 把表单归一化为提交给 /api/positions 的 payload。
export function normalizePositionPayload(form, quote) {
  const derived = derivePositionNumbers(form, quote);
  return {
    code: form.code,
    name: form.name || form.code,
    market: form.market,
    quoteSecid: form.quoteSecid || "",
    shares: derived.shares || 0,
    cost: derived.cost || 0
  };
}

// 录入区的实时提示文案。
export function positionEntryHint(form, quote, derived) {
  if (!form.code) return "先搜索并选择标的";
  if (derived.blocked) return "金额估算需要先选中搜索结果，系统拿到现价后再计算";
  const selected = form.name ? `${form.name}（${form.code}）` : form.code;
  const quoteText = quote ? ` · ${formatQuoteHint(quote)}` : "";
  if (derived.shares && derived.cost) return `${selected}${quoteText} · 入库 ${formatNumber(derived.shares)} 股 / 成本 ${formatMoney(derived.cost, 3)}`;
  if (derived.shares) return `${selected}${quoteText} · 入库 ${formatNumber(derived.shares)} 股 / 成本未知`;
  return `${selected}${quoteText} · 可只建仓，稍后补数量和成本`;
}

// 持仓行情键：优先显式 secid，其次场外基金用 6 位代码。
export function positionQuoteKey(position) {
  if (position.quoteSecid) return position.quoteSecid;
  const code = String(position.code || "");
  if (position.market === "基金" || /^16\d{4}$/.test(code)) return code;
  return "";
}
