/** 组合分析面板：分布环形图 + 收益归因 + 健康度 + 底层主题穿透。 */
import type { DistRow, PortfolioAnalysis } from "@/hooks/useMarket";

const COLORS = ["#9a6d24", "#2d6b43", "#a82f22", "#7c3aed", "#0891b2", "#b45309", "#64748b", "#be185d"];

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "暂无";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `¥${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `¥${(v / 1e4).toFixed(2)}万`;
  return `¥${v.toFixed(0)}`;
}
function fmtSignedMoney(v: number | null | undefined): string {
  if (v == null) return "暂无";
  return (v >= 0 ? "+" : "") + fmtMoney(v).replace("¥", "¥");
}
function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? "暂无" : `${v.toFixed(digits)}%`;
}
function fmtSignedPct(v: number | null | undefined): string {
  return v == null ? "暂无" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function Donut({ rows, center, centerLabel }: { rows: DistRow[]; center: string; centerLabel: string }) {
  let cursor = 0;
  const segments: string[] = [];
  rows.forEach((row, i) => {
    const start = cursor;
    const end = Math.min(100, cursor + Math.max(0, row.weight));
    cursor = end;
    segments.push(`${COLORS[i % COLORS.length]} ${start}% ${end}%`);
  });
  if (cursor < 100) segments.push(`var(--panel-soft) ${cursor}% 100%`);
  if (!rows.length) segments.push("var(--panel-soft) 0% 100%");
  return (
    <div className="donut" style={{ background: `conic-gradient(${segments.join(",")})` }}>
      <div className="donut-center">
        <strong>{center}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

function DistributionCard({
  title,
  subtitle,
  rows,
  center,
  centerLabel,
}: {
  title: string;
  subtitle: string;
  rows: DistRow[];
  center: string;
  centerLabel: string;
}) {
  return (
    <section className="panel analysis-card">
      <div className="analysis-card-head">
        <h3>{title}</h3>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="dist-body">
        <Donut rows={rows} center={center} centerLabel={centerLabel} />
        <div className="dist-legend">
          {rows.length ? (
            rows.map((row, i) => (
              <div className="dist-legend-row" key={row.label}>
                <i style={{ background: COLORS[i % COLORS.length] }} />
                <span className="dist-label">{row.label}</span>
                <strong>{fmtPct(row.weight)}</strong>
                <em className="muted">{fmtMoney(row.value)}</em>
              </div>
            ))
          ) : (
            <div className="muted">暂无分布数据</div>
          )}
        </div>
      </div>
    </section>
  );
}

function AttributionCard({ rows }: { rows: PortfolioAnalysis["analysis"]["pnlRows"] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <section className="panel analysis-card">
      <div className="analysis-card-head">
        <h3>收益归因</h3>
        <p className="muted">按持仓浮动盈亏贡献排序</p>
      </div>
      <div className="bar-list">
        {rows.length ? (
          rows.map((r) => (
            <div className={`bar-row ${r.tone}`} key={r.label}>
              <div className="bar-meta">
                <span>{r.label}</span>
                <strong>
                  {fmtSignedMoney(r.value)} · {fmtSignedPct(r.detailPct)}
                </strong>
              </div>
              <div className="bar-track">
                <i style={{ width: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%` }} />
              </div>
            </div>
          ))
        ) : (
          <div className="muted">暂无可归因的盈亏数据</div>
        )}
      </div>
    </section>
  );
}

function HealthCard({ a }: { a: PortfolioAnalysis["analysis"] }) {
  return (
    <section className="panel analysis-card">
      <div className="analysis-card-head">
        <h3>仓位健康度</h3>
        <p className="muted">集中度、数据覆盖和风险暴露</p>
      </div>
      <div className="health-body">
        <div className={`health-score ${a.healthTone}`}>
          <strong>{a.healthScore}</strong>
          <span>{a.healthLabel}</span>
        </div>
        <div className="health-factors">
          {a.healthFactors.map((f) => (
            <div className="health-factor" key={f.label}>
              <div className="health-factor-head">
                <span>{f.label}</span>
                <strong>{fmtPct(f.value)}</strong>
              </div>
              <div className="health-factor-track">
                <i style={{ width: `${f.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="health-alerts">
        {a.healthAlerts.map((al) => (
          <span className={al.tone} key={al.text}>
            {al.text}
          </span>
        ))}
      </div>
    </section>
  );
}

function ThemeCard({ a }: { a: PortfolioAnalysis["analysis"] }) {
  return (
    <section className="panel analysis-card">
      <div className="analysis-card-head">
        <h3>底层主题暴露</h3>
        <p className="muted">规则估算，基金底仓穿透待接入 · 识别覆盖 {fmtPct(a.themeCoverage)}</p>
      </div>
      <div className="theme-list">
        {a.themeRows.length ? (
          a.themeRows.map((row, i) => (
            <div className="theme-row" key={row.label}>
              <div className="theme-main">
                <div className="theme-title">
                  <i style={{ background: COLORS[i % COLORS.length] }} />
                  <span>{row.label}</span>
                  <strong>{fmtPct(row.weight)}</strong>
                </div>
                <div className="theme-track">
                  <i style={{ width: `${Math.max(3, row.weight)}%` }} />
                </div>
                <p className="muted">{row.contributors.slice(0, 4).map((c) => c.name).join("、") || "待识别"}</p>
              </div>
              <strong className="theme-value">{fmtMoney(row.value)}</strong>
            </div>
          ))
        ) : (
          <div className="muted">暂无主题暴露数据</div>
        )}
      </div>
    </section>
  );
}

export function PortfolioAnalysisPanel({ data }: { data: PortfolioAnalysis }) {
  const a = data.analysis;
  if (!a.count) {
    return (
      <div className="panel empty-state">
        <strong>暂无可分析持仓</strong>
        <p className="muted">添加持仓后自动生成组合分布、收益归因和仓位健康度。</p>
      </div>
    );
  }
  return (
    <div className="analysis-panel">
      <div className="analysis-quality-strip">
        <span>行情覆盖 {fmtPct(a.priceCoverage)}</span>
        <span>成本覆盖 {fmtPct(a.costCoverage)}</span>
        <span>主题识别 {fmtPct(a.themeCoverage)}</span>
      </div>

      <div className="stat-row">
        <div className="stat-cell">
          <span className="stat-num">{fmtMoney(a.totalMarket)}</span>
          <span className="muted">总市值 · {a.count} 只</span>
        </div>
        <div className="stat-cell">
          <span className={`stat-num ${a.pnl >= 0 ? "up" : "down"}`}>{fmtSignedMoney(a.pnl)}</span>
          <span className="muted">浮动盈亏 · {fmtSignedPct(a.pnlPct)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{fmtPct(a.maxWeight)}</span>
          <span className="muted">最大单仓 · {a.largestHolding?.name ?? "暂无"}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{a.healthScore}</span>
          <span className="muted">健康度 · {a.healthLabel}</span>
        </div>
      </div>

      <div className="analysis-grid-2">
        <DistributionCard title="市场分布" subtitle="A股、科创成长、美股海外和固收方向"
          rows={a.marketRows} center={fmtPct(a.topMarketWeight, 0)} centerLabel="第一方向" />
        <DistributionCard title="资产类型" subtitle="ETF、指数基金、主动基金和股票仓位"
          rows={a.assetRows} center={fmtPct(a.topAssetWeight, 0)} centerLabel="第一类型" />
      </div>
      <div className="analysis-grid-2">
        <DistributionCard title="风险分布" subtitle="按 AI 风险标签汇总仓位"
          rows={a.riskRows} center={`${a.highRiskCount}`} centerLabel="高风险" />
        <AttributionCard rows={a.pnlRows} />
      </div>
      <div className="analysis-grid-2">
        <HealthCard a={a} />
        <ThemeCard a={a} />
      </div>
    </div>
  );
}
