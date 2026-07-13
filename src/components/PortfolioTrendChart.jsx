// 组合市值 / 盈亏走势曲线卡片（.doc/持仓市值走势曲线设计与验收清单 §5.2）。
// 三指标单线切换（市值/盈利额/盈利率）+ 半年/总共范围切换 + 端点标注 + 口径提示 + 降级态。
// 口径：按当前持仓结构回溯历史行情，非账户真实历史市值（UI 强制标注）。
import { portfolioHistory, loadPortfolioHistory } from "../store.js";
import { formatMoney, formatSignedMoney, formatSignedPct, formatPercent } from "../lib/format.js";

const METRICS = [
  { key: "marketValue", label: "持仓市值", tone: "neutral" },
  { key: "pnl", label: "盈利额", tone: "signed" },
  { key: "pnlPct", label: "盈利率", tone: "signed" },
];

const RANGES = [
  { key: "6m", label: "最近半年" },
  { key: "all", label: "截至目前" },
];

export function PortfolioTrendChart({ state, onMetric, metric = "marketValue" }) {
  const range = state?.range || "6m";
  const status = state?.status || "idle";
  const series = Array.isArray(state?.series) ? state.series : [];
  const coverage = state?.coverage || null;
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0];

  return (
    <section class="portfolio-trend">
      <header class="portfolio-trend-head">
        <div>
          <h3>持仓市值 / 盈亏走势</h3>
          <p class="portfolio-trend-caption">按当前持仓结构回溯历史行情，非账户真实历史市值</p>
        </div>
        <div class="portfolio-trend-controls">
          <div class="portfolio-trend-tabs" role="tablist" aria-label="指标切换">
            {METRICS.map((m) => (
              <button key={m.key} type="button"
                class={`portfolio-trend-tab ${metric === m.key ? "active" : ""}`}
                onClick={() => onMetric?.(m.key)}>{m.label}</button>
            ))}
          </div>
          <div class="portfolio-trend-tabs" role="tablist" aria-label="范围切换">
            {RANGES.map((r) => (
              <button key={r.key} type="button"
                class={`portfolio-trend-tab ${range === r.key ? "active" : ""}`}
                onClick={() => loadPortfolioHistory(r.key)}>{r.label}</button>
            ))}
          </div>
        </div>
      </header>

      <TrendBody status={status} series={series} coverage={coverage} metric={activeMetric}
        error={state?.error} asOf={state?.asOf} range={range}
        fullCoverageSince={state?.fullCoverageSince} syncStatus={state?.syncStatus} />
    </section>
  );
}

// PLACEHOLDER_BODY

function TrendBody({ status, series, coverage, metric, error, asOf, range, fullCoverageSince, syncStatus }) {
  if (status === "loading" && !series.length) return <div class="portfolio-trend-empty">加载中…</div>;
  if (status === "error") return <div class="portfolio-trend-empty error">加载失败：{error || "未知错误"}</div>;
  if (!series.length || (coverage && coverage.covered === 0)) {
    return <div class="portfolio-trend-empty">暂无历史数据，执行「同步历史」或日更后可见。</div>;
  }

  const values = series.map((p) => Number(p[metric.key])).filter((v) => Number.isFinite(v));
  if (values.length < 2) return <div class="portfolio-trend-empty">历史数据点不足，无法绘制曲线。</div>;

  const last = values[values.length - 1];
  // 盈亏正负配色：正=红、负=绿（项目涨红跌绿约定）；市值线中性。
  const tone = metric.tone === "signed" ? (last >= 0 ? "up" : "down") : "neutral";
  const fmt = (v) => metric.key === "marketValue" ? formatMoney(v) : metric.key === "pnl" ? formatSignedMoney(v) : formatSignedPct(v);

  const skipped = coverage?.skipped || [];
  const stale = (coverage?.assets || []).filter((a) => a.staleDays >= 2);
  const bothFull = coverage && coverage.positionCoverage === 100 && coverage.costCoverage === 100;
  // range=all 且成分未集齐：标注区间
  const partialComposition = range === "all" && fullCoverageSince && series[0]?.date && series[0].date < fullCoverageSince;
  const truncated = (syncStatus?.truncatedSecids || []).length > 0;

  return (
    <div class={`portfolio-trend-body tone-${tone}`}>
      <TrendLine series={series} metricKey={metric.key} fmt={fmt} withZero={metric.tone === "signed"} />
      <div class="portfolio-trend-meta">
        <span>数据截至 {asOf || "-"}</span>
        {coverage && <span>覆盖 {formatPercent(coverage.positionCoverage, 0)} 持仓 / {formatPercent(coverage.costCoverage, 0)} 成本</span>}
        {bothFull ? <span class="muted">末点可与概览对照</span> : <span class="muted">覆盖范围内回溯曲线</span>}
      </div>
      {skipped.length > 0 && (
        <p class="portfolio-trend-note">{skipped.length} 只标的未纳入：{skipped.map((s) => s.name || s.code).join("、")}</p>
      )}
      {stale.length > 0 && <p class="portfolio-trend-note">部分净值存在滞后（{stale.map((a) => a.name || a.code).join("、")}）</p>}
      {partialComposition && (
        <p class="portfolio-trend-note warn">{fullCoverageSince} 之前成分未集齐，市值受标的上市先后影响，非完整组合历史</p>
      )}
      {truncated && <p class="portfolio-trend-note warn">历史数据存在分页截断，早期区间可能不完整</p>}
    </div>
  );
}

// 放大版内联 SVG 折线：固定 viewBox + CSS width:100%，端点/极值静态标注（本项目无 tooltip 设施）。
function TrendLine({ series, metricKey, fmt, withZero }) {
  const width = 720;
  const height = 200;
  const padX = 8;
  const padY = 24;
  const pts = series.map((p) => Number(p[metricKey]));
  let min = Math.min(...pts);
  let max = Math.max(...pts);
  if (withZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const span = max - min || 1;
  const n = series.length;
  const x = (i) => padX + i * ((width - padX * 2) / (n - 1));
  const y = (v) => height - padY - ((v - min) / span) * (height - padY * 2);

  const coords = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const maxIdx = pts.indexOf(max);
  const minIdx = pts.indexOf(min);
  const zeroY = y(0);

  return (
    <svg class="portfolio-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="持仓走势曲线">
      {withZero && min < 0 && max > 0 && (
        <line x1={padX} y1={zeroY} x2={width - padX} y2={zeroY} class="portfolio-trend-zero" stroke-dasharray="4 4" />
      )}
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      {/* 端点 + 极值标注 */}
      <TrendDot x={x(0)} y={y(pts[0])} label={fmt(pts[0])} anchor="start" date={series[0].date} />
      <TrendDot x={x(n - 1)} y={y(pts[n - 1])} label={fmt(pts[n - 1])} anchor="end" date={series[n - 1].date} />
      {maxIdx !== 0 && maxIdx !== n - 1 && <TrendDot x={x(maxIdx)} y={y(max)} label={fmt(max)} anchor="middle" />}
      {minIdx !== 0 && minIdx !== n - 1 && <TrendDot x={x(minIdx)} y={y(min)} label={fmt(min)} anchor="middle" />}
    </svg>
  );
}

function TrendDot({ x, y, label, anchor, date }) {
  const dx = anchor === "start" ? 4 : anchor === "end" ? -4 : 0;
  const textY = y < 30 ? y + 16 : y - 8;
  return (
    <g class="portfolio-trend-dot">
      <circle cx={x} cy={y} r="3" fill="currentColor" />
      <text x={x + dx} y={textY} text-anchor={anchor} class="portfolio-trend-label">{label}</text>
      {date && <text x={x + dx} y={textY + 12} text-anchor={anchor} class="portfolio-trend-date">{date}</text>}
    </g>
  );
}
