// Today 页板块压力卡片（.doc/板块压力监控模块设计与验收清单.md §五）。
// 展示综合压力分 + 分项迷你条 + 近30日 sparkline + 语义化状态。
// tone 阈值与后端一致：>=70 红（危险）、<=30 绿（低压）、其间琥珀。

export function PressureCard({ theme }) {
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
          <Sparkline series={theme.series30} tone={tone} />
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
        </>
      ) : (
        <p class="pressure-empty">日线数据尚未就绪，执行日更或点击刷新后可见。</p>
      )}
    </article>
  );
}

// 近30日综合分走势迷你折线（内联 SVG，无第三方依赖）。
function Sparkline({ series = [], tone }) {
  if (series.length < 2) return null;
  const width = 260;
  const height = 44;
  const values = series.map((p) => p.composite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const points = series.map((p, i) => {
    const x = i * step;
    const y = height - ((p.composite - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg class={`pressure-spark tone-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="近30日压力走势">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
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
