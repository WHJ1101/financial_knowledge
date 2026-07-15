// Today 页板块压力卡片（.doc/板块压力监控模块设计与验收清单.md §五）。
// 展示综合压力分 + 分项迷你条 + 近30日 sparkline + 语义化状态。
// tone 阈值与后端一致：>=70 红（危险）、<=30 绿（低压）、其间琥珀。
// 交互：sparkline hover 显示日期+压力分；点击「放大」弹层看大图（.doc 交互增强）。
import { useRef, useState } from "preact/hooks";
import { useLineHover } from "../lib/chart-hooks.js";
import { ChartModal } from "./ChartModal.jsx";

export function PressureCard({ theme }) {
  const [zoomed, setZoomed] = useState(false);
  if (!theme) return null;
  const hasData = theme.composite != null;
  const tone = scoreTone(theme.composite);

  return (
    <article class={`pressure-card tone-${tone}`}>
      <header class="pressure-card-head">
        <div>
          <strong>{theme.name}</strong>
          <span class="pressure-market">{theme.market}</span>
        </div>
        <div class="pressure-score">
          {hasData ? <strong>{Math.round(theme.composite)}</strong> : <strong class="muted">--</strong>}
          <span>/100</span>
        </div>
      </header>

      <p class={`pressure-status tone-${tone}`}>{theme.status || "数据不足"}</p>

      {hasData ? (
        <>
          <div class="pressure-spark-row">
            <Sparkline series={theme.series30} tone={tone} />
            {theme.series30?.length >= 2 && (
              <button type="button" class="pressure-zoom-btn" onClick={() => setZoomed(true)} aria-label="放大压力走势">⤢</button>
            )}
          </div>
          <ul class="pressure-subs">
            {theme.subScores.map((sub) => (
              <li key={sub.key}>
                <div class="pressure-sub-label">
                  <span>{sub.label}</span>
                  <span class="pressure-sub-raw">{sub.rawText}</span>
                </div>
                <div class="pressure-bar">
                  <div class={`pressure-bar-fill tone-${scoreTone(sub.score)}`} style={{ width: `${clampPct(sub.score)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p class="pressure-foot">{theme.date} · 滚动百分位合成，越高越危险</p>
          <ChartModal open={zoomed} title={`${theme.name} · 近30日压力走势`} onClose={() => setZoomed(false)}>
            <PressureLineLarge series={theme.series30} tone={tone} />
          </ChartModal>
        </>
      ) : (
        <p class="pressure-empty">日线数据尚未就绪，执行日更或点击刷新后可见。</p>
      )}
    </article>
  );
}

// 近30日综合分走势迷你折线（内联 SVG，无第三方依赖）。hover 显示日期+压力分。
function Sparkline({ series = [], tone }) {
  const svgRef = useRef(null);
  const width = 260;
  const height = 44;
  const { hoverIndex, bindHover } = useLineHover(svgRef, () => ({ start: 0, end: Math.max(0, series.length - 1) }), series.length, false);
  if (series.length < 2) return null;
  const values = series.map((p) => p.composite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const xy = (i) => ({ x: i * step, y: height - ((values[i] - min) / span) * (height - 6) - 3 });
  const points = series.map((_, i) => { const p = xy(i); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; });
  const hi = hoverIndex != null && hoverIndex >= 0 && hoverIndex < series.length ? hoverIndex : null;
  const hp = hi != null ? xy(hi) : null;
  const tipLeftPct = hi != null ? (hi / (series.length - 1)) * 100 : 0;

  return (
    <div class="pressure-spark-wrap">
      <svg ref={svgRef} class={`pressure-spark tone-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        role="img" aria-label="近30日压力走势" onMouseMove={bindHover.onMouseMove} onMouseLeave={bindHover.onMouseLeave}>
        <polyline points={points.join(" ")} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        {hp && <line x1={hp.x} y1="0" x2={hp.x} y2={height} class="chart-cursor" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" />}
      </svg>
      {hi != null && (
        <div class="chart-tip" style={{ left: `${tipLeftPct}%` }}>
          <span class="chart-tip-date">{series[hi].date}</span>
          <strong>{Math.round(series[hi].composite)}</strong>
        </div>
      )}
    </div>
  );
}

// 放大态大号压力折线（弹层内，复用 hover）。
function PressureLineLarge({ series = [], tone }) {
  const svgRef = useRef(null);
  const width = 640;
  const height = 260;
  const pad = 16;
  const { hoverIndex, bindHover } = useLineHover(svgRef, () => ({ start: 0, end: Math.max(0, series.length - 1) }), series.length, false);
  if (series.length < 2) return <div class="portfolio-trend-empty">数据点不足</div>;
  const values = series.map((p) => p.composite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad + i * ((width - pad * 2) / (series.length - 1));
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = series.map((_, i) => `${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`);
  const hi = hoverIndex != null && hoverIndex >= 0 && hoverIndex < series.length ? hoverIndex : null;
  const tipLeftPct = hi != null ? (hi / (series.length - 1)) * 100 : 0;

  return (
    <div class="pressure-large-wrap">
      <svg ref={svgRef} class={`pressure-spark tone-${tone}`} viewBox={`0 0 ${width} ${height}`}
        role="img" aria-label="近30日压力走势（放大）" onMouseMove={bindHover.onMouseMove} onMouseLeave={bindHover.onMouseLeave}>
        <polyline points={points.join(" ")} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        {hi != null && (
          <g>
            <line x1={x(hi)} y1={pad} x2={x(hi)} y2={height - pad} class="chart-cursor" stroke-dasharray="3 3" />
            <circle cx={x(hi)} cy={y(values[hi])} r="4" fill="currentColor" stroke="#fff" stroke-width="1.5" />
          </g>
        )}
      </svg>
      {hi != null && (
        <div class="chart-tip" style={{ left: `${tipLeftPct}%` }}>
          <span class="chart-tip-date">{series[hi].date}</span>
          <strong>{Math.round(series[hi].composite)}</strong>
        </div>
      )}
    </div>
  );
}


function scoreTone(score) {
  if (score == null) return "muted";
  if (score >= 70) return "high";
  if (score <= 30) return "low";
  return "mid";
}

function clampPct(score) {
  if (score == null) return 0;
  return Math.max(0, Math.min(100, score));
}
