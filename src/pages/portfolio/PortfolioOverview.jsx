import { formatMoney, formatSignedMoney, formatSignedPct } from "../../lib/format.js";

export function PortfolioOverview({ overview }) {
  return (
    <div class="portfolio-summary">
      <SummaryMetric label="总市值" value={formatMoney(overview.marketValue)} hint={`${overview.positionCount} 只持仓`} />
      <SummaryMetric label="浮动盈亏" value={formatSignedMoney(overview.pnl)} hint={`${formatSignedPct(overview.pnlPct)}`} tone={overview.pnl >= 0 ? "up" : "down"} />
      <SummaryMetric label="AI 待处理" value={overview.analyzingCount} hint="分析中 / 失败" tone={overview.analyzingCount ? "warn" : ""} />
      <SummaryMetric label="高风险提示" value={overview.highRiskCount} hint="需复核标的" tone={overview.highRiskCount ? "warn" : ""} />
    </div>
  );
}

function SummaryMetric({ label, value, hint, tone = "" }) {
  return (
    <div class={`summary-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}
