import { useState } from "preact/hooks";
import { CHART_COLORS } from "../../lib/portfolio-analysis.js";
import { formatMoney, formatPercent, formatSignedMoney, formatSignedPct } from "../../lib/format.js";
import { PortfolioTrendChart } from "../../components/PortfolioTrendChart.jsx";
import { portfolioHistory } from "../../store.js";

export function PortfolioAnalysisPanel({ analysis }) {
  const [trendMetric, setTrendMetric] = useState("marketValue");
  if (!analysis.count) {
    return (
      <div class="portfolio-analysis">
        <div class="portfolio-analysis-empty">
          <strong>暂无可分析持仓</strong>
          <p>添加持仓后，会自动生成组合分布、收益归因和仓位健康度。</p>
        </div>
      </div>
    );
  }

  return (
    <div class="portfolio-analysis">
      <div class="portfolio-analysis-head">
        <div>
          <h2>组合分析</h2>
          <p>从仓位、盈亏、风险和主题暴露看清组合结构。</p>
        </div>
        <div class="analysis-quality-strip">
          <span>行情覆盖 {formatPercent(analysis.priceCoverage)}</span>
          <span>成本覆盖 {formatPercent(analysis.costCoverage)}</span>
          <span>主题识别 {formatPercent(analysis.themeCoverage)}</span>
        </div>
      </div>

      <div class="analysis-snapshot-grid">
        <SnapshotMetric label="总市值" value={formatMoney(analysis.totalMarket)} hint={`${analysis.count} 只持仓`} />
        <SnapshotMetric label="浮动盈亏" value={formatSignedMoney(analysis.pnl)} hint={formatSignedPct(analysis.pnlPct)} tone={analysis.pnl >= 0 ? "up" : "down"} />
        <SnapshotMetric label="最大单仓" value={formatPercent(analysis.maxWeight)} hint={analysis.largestHolding?.name || "暂无"} tone={analysis.maxWeight > 35 ? "warn" : ""} />
        <SnapshotMetric label="健康度" value={`${analysis.healthScore}`} hint={analysis.healthLabel} tone={analysis.healthTone} />
      </div>

      <PortfolioTrendChart state={portfolioHistory.value} metric={trendMetric} onMetric={setTrendMetric} />

      <div class="portfolio-analysis-grid two">
        <DistributionCard title="市场分布" subtitle="A股、科创成长、美股海外和固收方向" rows={analysis.marketRows} center={`${formatPercent(analysis.topMarketWeight, 0)}`} centerLabel="第一方向" />
        <DistributionCard title="资产类型" subtitle="ETF、指数基金、主动基金和股票仓位" rows={analysis.assetRows} center={`${formatPercent(analysis.topAssetWeight, 0)}`} centerLabel="第一类型" />
      </div>

      <div class="portfolio-analysis-grid two">
        <DistributionCard title="风险分布" subtitle="按 AI 风险标签汇总仓位" rows={analysis.riskRows} center={`${analysis.highRiskCount}`} centerLabel="高风险" />
        <AttributionPanel rows={analysis.pnlRows} />
      </div>

      <div class="portfolio-analysis-grid two">
        <HealthPanel analysis={analysis} />
        <ThemeExposurePanel analysis={analysis} compact />
      </div>
    </div>
  );
}

function SnapshotMetric({ label, value, hint, tone = "" }) {
  return (
    <div class={`analysis-snapshot ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function AnalysisCard({ title, subtitle, children }) {
  return (
    <section class="portfolio-analysis-card">
      <div class="analysis-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function DistributionCard({ title, subtitle, rows, center, centerLabel }) {
  return (
    <AnalysisCard title={title} subtitle={subtitle}>
      <div class="distribution-card-body">
        <DonutChart rows={rows} center={center} centerLabel={centerLabel} />
        <div class="analysis-legend">
          {rows.length ? rows.map((row, index) => (
            <div class="analysis-legend-row" key={row.label}>
              <i style={`background:${CHART_COLORS[index % CHART_COLORS.length]}`} />
              <span>{row.label}</span>
              <strong>{formatPercent(row.weight)}</strong>
              <em>{formatMoney(row.value)}</em>
            </div>
          )) : <div class="analysis-empty-line">暂无分布数据</div>}
        </div>
      </div>
    </AnalysisCard>
  );
}

function DonutChart({ rows, center, centerLabel }) {
  let cursor = 0;
  const segments = rows.length ? rows.map((row, index) => {
    const start = cursor;
    const end = Math.min(100, cursor + Math.max(0, row.weight || 0));
    cursor = end;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${end}%`;
  }) : ["#e7eef7 0% 100%"];
  if (cursor < 100) segments.push(`#eef3f8 ${cursor}% 100%`);

  return (
    <div class="portfolio-donut" style={`background: conic-gradient(${segments.join(",")});`}>
      <div>
        <strong>{center}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

function AttributionPanel({ rows }) {
  return (
    <AnalysisCard title="收益归因" subtitle="按持仓浮动盈亏贡献排序">
      <AnalysisBarList
        rows={rows}
        valueFormatter={(value, row) => `${formatSignedMoney(value)} · ${row.detail}`}
        emptyText="暂无可归因的盈亏数据"
      />
    </AnalysisCard>
  );
}

function HealthPanel({ analysis }) {
  return (
    <AnalysisCard title="仓位健康度" subtitle="集中度、数据覆盖和风险暴露">
      <div class="health-panel-body">
        <div class={`health-score ${analysis.healthTone}`}>
          <strong>{analysis.healthScore}</strong>
          <span>{analysis.healthLabel}</span>
        </div>
        <div class="health-factors">
          {analysis.healthFactors.map(item => (
            <div class="health-factor" key={item.label}>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div class="health-factor-track"><i style={`width:${item.percent}%`} /></div>
            </div>
          ))}
        </div>
      </div>
      <div class="health-alerts">
        {analysis.healthAlerts.map(item => <span class={item.tone} key={item.text}>{item.text}</span>)}
      </div>
    </AnalysisCard>
  );
}

function ThemeExposurePanel({ analysis, compact = false }) {
  return (
    <section class={`portfolio-analysis-card theme-exposure-card ${compact ? "compact" : ""}`}>
      <div class="analysis-card-head">
        <div>
          <h3>底层主题暴露</h3>
          <p>初版为规则估算，真实基金底仓穿透待接入。</p>
        </div>
        <span class="analysis-source-badge">识别覆盖 {formatPercent(analysis.themeCoverage)}</span>
      </div>
      <div class="theme-exposure-list">
        {analysis.themeRows.length ? analysis.themeRows.map((row, index) => (
          <div class="theme-exposure-row" key={row.label}>
            <div class="theme-exposure-main">
              <div class="theme-exposure-title">
                <i style={`background:${CHART_COLORS[index % CHART_COLORS.length]}`} />
                <span>{row.label}</span>
                <strong>{formatPercent(row.weight)}</strong>
              </div>
              <div class="theme-bar-track"><i style={`width:${Math.max(3, row.weight)}%`} /></div>
              <p>{row.contributors.slice(0, 4).map(item => item.name).join("、") || "待识别"}</p>
            </div>
            <strong class="theme-exposure-value">{formatMoney(row.value)}</strong>
          </div>
        )) : <div class="analysis-empty-line">暂无主题暴露数据</div>}
      </div>
    </section>
  );
}

function AnalysisBarList({ rows, valueFormatter, emptyText }) {
  const max = Math.max(1, ...rows.map(row => Math.abs(row.value || 0)));
  if (!rows.length) return <div class="analysis-empty-line">{emptyText}</div>;
  return (
    <div class="analysis-bar-list">
      {rows.map(row => {
        const tone = row.tone || (row.value >= 0 ? "up" : "down");
        const width = Math.max(4, Math.abs(row.value || 0) / max * 100);
        return (
          <div class={`analysis-bar-row ${tone}`} key={row.key || row.label}>
            <div class="analysis-bar-meta">
              <span>{row.label}</span>
              <strong>{valueFormatter(row.value, row)}</strong>
            </div>
            <div class="analysis-bar-track"><i style={`width:${width}%`} /></div>
          </div>
        );
      })}
    </div>
  );
}
