// 组合视图的格式化工具。原先集中在 Portfolio.jsx 底部，抽出后可跨组件复用并单测。

export function formatMoney(value, digits = 0) {
  const n = Number(value || 0);
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatSignedMoney(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${formatMoney(n)}`;
}

export function formatSignedPct(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function formatPercent(value, digits = 1) {
  const n = Number(value || 0);
  return `${n.toFixed(digits)}%`;
}

export function formatQuoteHint(quote) {
  const pct = quote.changePct == null ? "" : ` · ${formatSignedPct(quote.changePct)}`;
  const source = quote.sourceLabel ? ` · ${quote.sourceLabel}` : "";
  return `现价 ${formatMoney(quote.price, 3)}${pct}${source}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}-${date.getDate()}`;
}
