/** 组合走势曲线（Recharts，方案 §11.7）。
 * 三指标切换（市值/盈利额/盈利率）+ 半年/全部范围 + hover tooltip。
 * 口径：按当前持仓结构回溯历史行情，非账户真实历史市值（UI 强制标注）。
 */
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolioHistory, type PortfolioPoint } from "@/hooks/useMarket";

type Metric = "marketValue" | "pnl" | "pnlPct";
type Range = "6m" | "all";

const METRICS: { key: Metric; label: string }[] = [
  { key: "marketValue", label: "持仓市值" },
  { key: "pnl", label: "盈利额" },
  { key: "pnlPct", label: "盈利率" },
];
const RANGES: { key: Range; label: string }[] = [
  { key: "6m", label: "最近半年" },
  { key: "all", label: "截至目前" },
];

function fmtMoney(v: number | null): string {
  if (v == null) return "暂无";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)} 万`;
  return v.toFixed(0);
}
function fmtPct(v: number | null): string {
  return v == null ? "暂无" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function PortfolioTrendChart() {
  const [metric, setMetric] = useState<Metric>("marketValue");
  const [range, setRange] = useState<Range>("6m");
  const q = usePortfolioHistory(range);
  const activeMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const isPct = metric === "pnlPct";
  const fmt = isPct ? fmtPct : fmtMoney;
  const series = q.data?.series ?? [];
  const coverage = q.data?.coverage;
  // 盈利额/盈利率用涨跌色（涨红跌绿，A股口径）；市值用中性金
  const accent = metric === "marketValue" ? "var(--accent)" : "var(--up)";

  return (
    <section className="trend-card">
      <header className="trend-head">
        <div>
          <h2>组合走势</h2>
          <p className="muted trend-note">按当前持仓结构回溯历史行情 · 非账户真实历史市值</p>
        </div>
        <div className="trend-controls">
          <div className="seg" role="group" aria-label="走势指标">
            {METRICS.map((m) => (
              <button aria-pressed={metric === m.key} key={m.key} className={metric === m.key ? "seg-btn active" : "seg-btn"}
                onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="走势时间范围">
            {RANGES.map((r) => (
              <button aria-pressed={range === r.key} key={r.key} className={range === r.key ? "seg-btn active" : "seg-btn"}
                onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {q.isLoading && <p className="muted pad">加载中…</p>}
      {q.isError && <div className="error-state" role="alert">组合走势加载失败 <button onClick={() => q.refetch()}>重试</button></div>}
      {!q.isLoading && !q.isError && series.length === 0 && (
        <p className="empty-inline">
          暂无历史数据。{coverage && coverage.covered === 0 ? "持仓未覆盖可回溯标的，先在设置里同步组合历史。" : ""}
        </p>
      )}

      {series.length > 0 && (
        <>
          <div className="trend-chart">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={48}
                  tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                <YAxis width={64} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false}
                  axisLine={false} tickFormatter={(v) => fmt(v as number)} />
                <Tooltip
                  contentStyle={{
                    background: "var(--panel)", border: "1px solid var(--line)",
                    borderRadius: 8, fontSize: 13,
                  }}
                  labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                  formatter={(value) => [fmt(value as number), activeMetric.label]}
                />
                <Area type="monotone" dataKey={metric} stroke={accent} strokeWidth={2}
                  fill="url(#trendFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <TrendFooter series={series} metric={metric} fmt={fmt} coverage={coverage} />
        </>
      )}
    </section>
  );
}

function TrendFooter({
  series,
  metric,
  fmt,
  coverage,
}: {
  series: PortfolioPoint[];
  metric: Metric;
  fmt: (v: number | null) => string;
  coverage: { covered: number; total: number } | undefined;
}) {
  const last = series[series.length - 1];
  const val = last ? (last[metric] as number | null) : null;
  return (
    <footer className="trend-foot">
      <span className="trend-latest">
        最新 <strong>{fmt(val)}</strong>
      </span>
      {coverage && (
        <span className="muted">
          覆盖 {coverage.covered}/{coverage.total} 标的 · {last?.date ?? ""}
        </span>
      )}
    </footer>
  );
}
