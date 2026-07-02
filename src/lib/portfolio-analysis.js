// 组合分析的纯计算逻辑。原先内联在 Portfolio.jsx（约 250 行），抽出后可单测。
import { formatPercent, formatSignedPct } from "./format.js";

export const CHART_COLORS = ["#2563eb", "#0f766e", "#dc2626", "#7c3aed", "#d97706", "#0891b2", "#64748b", "#be185d"];

// 由持仓原始数据 + 行情价格构建带盈亏、权重的持仓行。
export function buildHoldings(items, prices) {
  const rows = items.map(p => {
    const quote = prices[p.code];
    const price = typeof quote === "number" ? quote : quote?.price;
    const shares = Number(p.shares || 0);
    const cost = Number(p.cost || 0);
    const hasCost = cost > 0;
    const hasPrice = Number(price || 0) > 0;
    const costValue = hasCost ? shares * cost : 0;
    const marketValue = shares * Number(price || (hasCost ? cost : 0));
    const pnl = hasCost && hasPrice ? marketValue - costValue : null;
    const pnlPct = pnl == null || !costValue ? null : (pnl / costValue) * 100;
    return { ...p, shares, cost, hasCost, hasPrice, market: quote?.market || p.market, price, quoteSource: quote?.sourceLabel, costValue, marketValue, pnl, pnlPct };
  });
  const totalMarket = rows.reduce((sum, row) => sum + row.marketValue, 0);
  return rows.map(row => ({ ...row, weight: totalMarket ? (row.marketValue / totalMarket) * 100 : 0 }));
}

export function sortHoldings(rows, sort) {
  if (!sort || sort.key === "default") return rows;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortableHoldingValue(a, sort.key);
    const bv = sortableHoldingValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * direction;
  });
}

function sortableHoldingValue(row, key) {
  if (key === "marketValue") return Number(row.marketValue || 0);
  if (key === "pnlPct") return row.pnlPct == null ? null : Number(row.pnlPct);
  return null;
}

export function getOverview(holdings, stockRows, etfs) {
  const cost = holdings.reduce((sum, row) => sum + row.costValue, 0);
  const marketValue = holdings.reduce((sum, row) => sum + row.marketValue, 0);
  const costedMarketValue = holdings.filter(row => row.hasCost).reduce((sum, row) => sum + row.marketValue, 0);
  const pnl = costedMarketValue - cost;
  const analyzingCount = [...holdings, ...stockRows].filter(row => ["analyzing", "failed"].includes(row.analysisStatus)).length;
  const highRiskCount = [...holdings, ...stockRows].filter(row => riskLevel(row.risk) === "high").length;
  return {
    marketValue,
    pnl,
    pnlPct: cost ? (pnl / cost) * 100 : 0,
    analyzingCount,
    highRiskCount,
    positionCount: holdings.length,
    stockCount: stockRows.length,
    etfCount: etfs.length
  };
}

// PLACEHOLDER_ANALYSIS
export function buildPortfolioAnalysis(holdings) {
  const totalMarket = holdings.reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const totalCost = holdings.reduce((sum, row) => sum + Number(row.costValue || 0), 0);
  const costedMarketValue = holdings.filter(row => row.hasCost).reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const pnl = costedMarketValue - totalCost;
  const pnlPct = totalCost ? (pnl / totalCost) * 100 : 0;
  const count = holdings.length;
  const sortedByValue = [...holdings].sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0));
  const largestHolding = sortedByValue[0] || null;
  const maxWeight = largestHolding?.weight || 0;
  const top5Weight = totalMarket ? sortedByValue.slice(0, 5).reduce((sum, row) => sum + Number(row.marketValue || 0), 0) / totalMarket * 100 : 0;
  const priceCoverage = count ? holdings.filter(row => row.hasPrice).length / count * 100 : 0;
  const costCoverage = count ? holdings.filter(row => row.hasCost).length / count * 100 : 0;
  const highRiskRows = holdings.filter(row => riskLevel(row.risk) === "high");
  const highRiskValue = highRiskRows.reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const highRiskWeight = totalMarket ? highRiskValue / totalMarket * 100 : 0;
  const marketRows = groupHoldingRows(holdings, classifyMarketBucket, totalMarket);
  const assetRows = groupHoldingRows(holdings, classifyAssetBucket, totalMarket);
  const riskRows = groupHoldingRows(holdings, riskBucket, totalMarket);
  const themeRows = buildThemeRows(holdings, totalMarket);
  const themeKnownValue = themeRows.filter(row => row.label !== "其他/待穿透").reduce((sum, row) => sum + row.value, 0);
  const themeCoverage = totalMarket ? themeKnownValue / totalMarket * 100 : 0;
  const health = buildPortfolioHealth({ maxWeight, top5Weight, highRiskWeight, priceCoverage, costCoverage, themeCoverage });

  return {
    count,
    totalMarket,
    totalCost,
    pnl,
    pnlPct,
    largestHolding,
    maxWeight,
    top5Weight,
    topMarketWeight: marketRows[0]?.weight || 0,
    highRiskCount: highRiskRows.length,
    highRiskWeight,
    priceCoverage,
    costCoverage,
    themeCoverage,
    marketRows,
    assetRows,
    riskRows,
    themeRows,
    topAssetWeight: assetRows[0]?.weight || 0,
    pnlRows: buildAttributionRows(holdings),
    ...health
  };
}

function groupHoldingRows(holdings, getLabel, totalMarket) {
  const map = new Map();
  holdings.forEach(row => {
    const label = getLabel(row);
    const current = map.get(label) || { label, value: 0, count: 0 };
    current.value += Number(row.marketValue || 0);
    current.count += 1;
    map.set(label, current);
  });
  return Array.from(map.values())
    .map(row => ({ ...row, weight: totalMarket ? row.value / totalMarket * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function classifyMarketBucket(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  if (/债|货币|现金|增利|短债|纯债/.test(text)) return "固收/现金";
  if (/港股|恒生|香港|h股/.test(text)) return "港股";
  if (/美股|纳斯达克|标普|sp500|s&p|qdii|全球|海外|美元/.test(text)) return "美股/海外";
  if (/科创|半导体|芯片|集成电路|创业/.test(text)) return "A股科创成长";
  if (/中证|沪深|上证|深证|创业板|a股|etf|基金/.test(text)) return "A股宽基/基金";
  return row.market || "其他";
}

function classifyAssetBucket(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  if (/债|货币|现金|增利|短债|纯债/.test(text)) return "固收基金";
  if (/qdii|全球|海外|纳斯达克|标普/.test(text)) return "QDII / 海外基金";
  if (/etf|联接|指数|中证|沪深|上证|深证|创业板|科创/.test(text)) return "指数 / ETF";
  if (/基金|混合|股票型/.test(text)) return "主动基金";
  if (/a股|港股|美股|股票/.test(text)) return "股票";
  return row.market || "其他";
}

function riskBucket(row) {
  const level = riskLevel(row.risk);
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function buildAttributionRows(holdings) {
  return holdings
    .filter(row => row.pnl != null)
    .sort((a, b) => Math.abs(Number(b.pnl || 0)) - Math.abs(Number(a.pnl || 0)))
    .slice(0, 6)
    .map(row => ({
      key: row.id || row.code,
      label: row.name,
      value: Number(row.pnl || 0),
      detail: formatSignedPct(row.pnlPct),
      tone: Number(row.pnl || 0) >= 0 ? "up" : "down"
    }));
}
// PLACEHOLDER_THEME
function buildThemeRows(holdings, totalMarket) {
  const map = new Map();
  holdings.forEach(row => {
    const themes = inferThemes(row);
    const totalWeight = themes.reduce((sum, item) => sum + item.weight, 0) || 1;
    themes.forEach(theme => {
      const value = Number(row.marketValue || 0) * theme.weight / totalWeight;
      const current = map.get(theme.label) || { label: theme.label, value: 0, contributors: [] };
      current.value += value;
      current.contributors.push({ name: row.name, value });
      map.set(theme.label, current);
    });
  });

  return Array.from(map.values())
    .map(row => ({
      ...row,
      contributors: row.contributors.sort((a, b) => b.value - a.value),
      weight: totalMarket ? row.value / totalMarket * 100 : 0
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

function inferThemes(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  const themes = [];
  const add = (label, weight) => themes.push({ label, weight });

  if (/光模块|光通信|cpo|光器件/.test(text)) add("光模块/CPO", 1);
  if (/dram|hbm|内存/.test(text)) add("DRAM/HBM", 1);
  if (/nand|存储|闪存/.test(text)) add("NAND/存储", 1);
  if (/半导体|芯片|集成电路/.test(text)) {
    add("芯片/半导体", 0.58);
    add("AI 算力/科技", 0.18);
    add("DRAM/HBM", 0.08);
    add("NAND/存储", 0.06);
    add("科创成长", 0.1);
  }
  if (/科创|创业/.test(text)) {
    add("科创成长", 0.46);
    add("芯片/半导体", 0.24);
    add("AI 算力/科技", 0.18);
    add("高端制造", 0.12);
  }
  if (/纳斯达克|nasdaq|全球科技|科技先锋/.test(text)) {
    add("美股科技", 0.48);
    add("AI 算力/科技", 0.27);
    add("芯片/半导体", 0.14);
    add("海外资产", 0.11);
  }
  if (/标普|sp500|s&p/.test(text)) {
    add("美股宽基", 0.7);
    add("海外资产", 0.2);
    add("AI 算力/科技", 0.1);
  }
  if (/中证500|500指数/.test(text)) add("A股中盘宽基", 1);
  if (/上证50|沪深300|中证1000|全a|a500|深证100/.test(text)) add("A股宽基", 1);
  if (/债|货币|现金|增利|短债|纯债/.test(text)) add("固收/现金", 1);
  if (/医药|医疗|创新药/.test(text)) add("医药医疗", 1);
  if (/消费|白酒|食品/.test(text)) add("消费", 1);

  return themes.length ? themes : [{ label: "其他/待穿透", weight: 1 }];
}

function buildPortfolioHealth({ maxWeight, top5Weight, highRiskWeight, priceCoverage, costCoverage, themeCoverage }) {
  let score = 100;
  if (maxWeight > 35) score -= Math.min(22, (maxWeight - 35) * 0.8);
  if (top5Weight > 80) score -= Math.min(18, (top5Weight - 80) * 0.8);
  if (highRiskWeight > 35) score -= Math.min(20, (highRiskWeight - 35) * 0.7);
  if (priceCoverage < 90) score -= Math.min(18, (90 - priceCoverage) * 0.5);
  if (costCoverage < 90) score -= Math.min(14, (90 - costCoverage) * 0.35);
  if (themeCoverage < 55) score -= Math.min(12, (55 - themeCoverage) * 0.25);
  const healthScore = Math.max(0, Math.round(score));
  const healthTone = healthScore >= 80 ? "good" : healthScore >= 60 ? "warn" : "bad";
  const healthLabel = healthScore >= 80 ? "结构稳健" : healthScore >= 60 ? "需要复核" : "风险偏高";
  const healthAlerts = [];

  if (maxWeight > 35) healthAlerts.push({ text: `最大单仓 ${formatPercent(maxWeight)}，集中度偏高`, tone: "warn" });
  if (top5Weight > 80) healthAlerts.push({ text: `前五持仓 ${formatPercent(top5Weight)}，组合分散度不足`, tone: "warn" });
  if (highRiskWeight > 35) healthAlerts.push({ text: `高风险仓位 ${formatPercent(highRiskWeight)}，需复核止损线`, tone: "bad" });
  if (priceCoverage < 90) healthAlerts.push({ text: `行情覆盖 ${formatPercent(priceCoverage)}，部分市值待更新`, tone: "warn" });
  if (costCoverage < 90) healthAlerts.push({ text: `成本覆盖 ${formatPercent(costCoverage)}，收益归因不完整`, tone: "warn" });
  if (themeCoverage < 55) healthAlerts.push({ text: `主题识别 ${formatPercent(themeCoverage)}，底仓穿透待增强`, tone: "muted" });
  if (!healthAlerts.length) healthAlerts.push({ text: "仓位、风险和数据覆盖暂无明显异常", tone: "good" });

  return {
    healthScore,
    healthTone,
    healthLabel,
    healthAlerts,
    healthFactors: [
      { label: "最大单仓", value: formatPercent(maxWeight), percent: Math.min(100, maxWeight) },
      { label: "前五集中", value: formatPercent(top5Weight), percent: Math.min(100, top5Weight) },
      { label: "高风险仓位", value: formatPercent(highRiskWeight), percent: Math.min(100, highRiskWeight) },
      { label: "数据覆盖", value: formatPercent(Math.min(priceCoverage, costCoverage)), percent: Math.min(priceCoverage, costCoverage) },
    ]
  };
}
// PLACEHOLDER_RISK
export function riskLevel(text = "") {
  if (!text) return "low";
  if (/止损|跌破|失效|威胁|高风险|替代|下调|回调/.test(text)) return "high";
  if (/波动|不及预期|需求|政策|竞争|估值/.test(text)) return "medium";
  return "low";
}

export function actionLabel(text = "", status = "") {
  if (status === "analyzing") return "分析中";
  if (status === "failed") return "待重试";
  if (/止损/.test(text)) return "止损";
  if (/止盈/.test(text)) return "止盈";
  if (/减仓/.test(text)) return "减仓";
  if (/加仓/.test(text)) return "加仓";
  if (/持有/.test(text)) return "持有";
  if (/观察|关注/.test(text)) return "观察";
  return text ? "待复核" : "待分析";
}

export function statusText(status) {
  if (status === "done") return "已分析";
  if (status === "analyzing") return "分析中";
  if (status === "failed") return "失败";
  return "待分析";
}
