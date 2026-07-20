/** 板块压力卡片：四维合成分 + 分项 + 迷你走势。 */
import type { PressureTheme } from "@/hooks/useMarket";

function scoreLevel(score: number | null): string {
  if (score == null) return "none";
  if (score >= 70) return "high";
  if (score >= 30) return "mid";
  return "low";
}

export function PressureCard({ theme }: { theme: PressureTheme }) {
  const composite = theme.composite;
  const level = scoreLevel(composite);
  return (
    <article className="pressure-card">
      <header className="pressure-card-head">
        <div>
          <h3>{theme.name}</h3>
          <span className="muted">{theme.market}</span>
        </div>
        <div className={`pressure-score ${level}`}>
          {composite == null ? "暂无" : composite.toFixed(0)}
        </div>
      </header>
      <p className={`pressure-status ${theme.crossing ? "alert" : ""}`}>{theme.status}</p>
      <ul className="pressure-subs">
        {theme.subScores.map((score) => {
          const tooltipId = `pressure-help-${theme.id}-${score.key}`.replace(/[^a-zA-Z0-9_-]/g, "-");
          const scoreText = score.score == null ? "暂无" : score.score.toFixed(0);
          return (
            <li key={score.key}>
              <button
                className="pressure-metric-trigger"
                type="button"
                aria-label={`${score.label}，${score.rawText}，压力分 ${scoreText}`}
                aria-describedby={tooltipId}
              >
                <span className="pressure-sub-label">{score.label}</span>
                <span className="pressure-sub-raw muted">{score.rawText}</span>
                <span className={`pressure-sub-score ${scoreLevel(score.score)}`}>
                  {scoreText}
                </span>
              </button>
              <span className="pressure-tooltip" id={tooltipId} role="tooltip">
                <strong>{score.label}</strong>
                <span>当前值 {score.rawText}，压力分 {scoreText}。分数越高，表示该维度压力越大。</span>
              </span>
            </li>
          );
        })}
      </ul>
      {theme.date && <footer className="pressure-card-foot muted">截至 {theme.date}</footer>}
    </article>
  );
}
