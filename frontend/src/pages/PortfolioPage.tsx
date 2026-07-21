import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import {
  useAddPosition,
  useAddWatchlist,
  useAnalyzePosition,
  useAnalyzeWatchlist,
  useDeletePosition,
  useDeleteWatchlist,
  useWatchlist,
  type WatchlistItemView,
} from "@/hooks/usePortfolio";
import {
  usePortfolioAnalysis,
  useMarketIndices,
  type AnalysisHolding,
  type SearchResult,
} from "@/hooks/useMarket";
import { PortfolioTrendChart } from "@/components/PortfolioTrendChart";
import { PortfolioAnalysisPanel } from "@/components/PortfolioAnalysisPanel";
import { PositionDetail, WatchlistDetail } from "@/components/PortfolioDetailPanel";
import { SearchField } from "@/components/SearchField";
import { GlassPanel } from "@/components/LiquidGlass";

type Tab = "positions" | "analysis" | "watchlist" | "etfs";
type SortKey = "default" | "marketValue" | "pnlPct";
type OperationNote = { text: string; error: boolean };

const ANALYSIS_LABEL: Record<string, string> = {
  pending: "待分析",
  analyzing: "分析中",
  done: "已分析",
  failed: "分析失败",
};

function fmtMoney(v: number | null | undefined, d = 0): string {
  return v == null ? "暂无" : `¥${v.toFixed(d)}`;
}
function fmtSignedMoney(v: number | null | undefined): string {
  return v == null ? "暂无" : `${v >= 0 ? "+" : ""}¥${v.toFixed(0)}`;
}
function fmtSignedPct(v: number | null | undefined): string {
  return v == null ? "暂无" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtPct(v: number | null | undefined): string {
  return v == null ? "暂无" : `${v.toFixed(1)}%`;
}
export function formatChangePct(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "暂无";
  if (text.endsWith("%") || !/^[+-]?\d+(?:\.\d+)?$/.test(text)) return text;
  return `${text}%`;
}
function errorDetail(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

/** 持仓/自选/组合分析/指数基金 四 tab 工作台（方案 §11.4/§11.F）。 */
export function PortfolioPage() {
  const [tab, setTab] = useState<Tab>("positions");
  return (
    <div className="page fade-up">
      <header className="page-head knowledge-head">
        <div><h1>投资组合</h1><p className="muted">你的持仓与自选，仅你本人可见</p></div>
        <div className="knowledge-export">
          <a className="ghost-btn" href="/api/v1/export/positions.csv">导出 CSV</a>
          <a className="ghost-btn" href="/api/v1/export/positions.json">导出 JSON</a>
        </div>
      </header>

      <PortfolioTrendChart />

      <div className="tab-bar" role="tablist" aria-label="投资组合视图">
        {(
          [
            ["positions", "持仓"],
            ["analysis", "组合分析"],
            ["watchlist", "自选"],
            ["etfs", "指数基金"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button role="tab" aria-selected={tab === key} key={key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "positions" && <PositionsTab />}
      {tab === "analysis" && <AnalysisTab />}
      {tab === "watchlist" && <WatchlistTab />}
      {tab === "etfs" && <EtfsTab />}
    </div>
  );
}

function AnalysisTab() {
  const q = usePortfolioAnalysis();
  if (q.isLoading) return <p className="muted pad">加载中…（正在拉取实时行情）</p>;
  if (q.isError) return <div className="panel error-state" role="alert">组合分析加载失败 <button onClick={() => q.refetch()}>重试</button></div>;
  if (!q.data) return null;
  return <PortfolioAnalysisPanel data={q.data} />;
}

function PositionsTab() {
  const analysis = usePortfolioAnalysis();
  const add = useAddPosition();
  const del = useDeletePosition();
  const analyze = useAnalyzePosition();
  const [selected, setSelected] = useState<string | null>(null);
  const [operationNote, setOperationNote] = useState<OperationNote | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "default", dir: "desc" });
  const [form, setForm] = useState({ code: "", name: "", market: "A股", shares: "", cost: "" });

  const holdings = analysis.data?.holdings ?? [];
  const sorted = useMemo(() => {
    const key = sort.key;
    if (key === "default") return holdings;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...holdings].sort((a, b) => {
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      return (av - bv) * dir;
    });
  }, [holdings, sort]);

  const active = sorted.find((h) => h.id === selected) ?? sorted[0] ?? null;

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    add.mutate(
      { code: form.code, name: form.name, market: form.market, shares: Number(form.shares), cost: Number(form.cost) },
      {
        onSuccess: () => {
          setForm({ code: "", name: "", market: "A股", shares: "", cost: "" });
          setOperationNote({ text: "持仓已添加", error: false });
        },
        onError: (error) => setOperationNote({ text: errorDetail(error, "新增持仓失败"), error: true }),
      },
    );
  };
  const canAdd = Boolean(
    form.code.trim() &&
    form.name.trim() &&
    Number.isFinite(Number(form.shares)) &&
    Number(form.shares) > 0 &&
    Number.isFinite(Number(form.cost)) &&
    Number(form.cost) >= 0,
  );
  const toggleSort = (key: SortKey) =>
    setSort((s) => (key === "default" ? { key, dir: "desc" } : s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  return (
    <div className="workbench">
      <div className="workbench-main">
        <form className="inline-add-form" onSubmit={onAdd}>
          <SearchField
            value={form.code}
            onSearch={(v) => setForm({ ...form, code: v, name: "", market: "A股" })}
            onPick={(r: SearchResult) => setForm({ ...form, code: r.code, name: r.name, market: r.market })}
          />
          <input aria-label="持仓名称" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="持仓股数" inputMode="decimal" placeholder="股数" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} />
          <input aria-label="持仓成本" inputMode="decimal" placeholder="成本" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <button className="btn sm" type="submit" disabled={add.isPending || !canAdd}>
            {add.isPending ? "新增中…" : "新增"}
          </button>
        </form>
        {operationNote && <div className={operationNote.error ? "inline-note login-error" : "inline-note"} role={operationNote.error ? "alert" : "status"}>{operationNote.text}</div>}

        <div className="sortbar">
          <span className="muted">排序</span>
          {([["default", "默认"], ["marketValue", "市值"], ["pnlPct", "收益率"]] as [SortKey, string][]).map(([k, l]) => (
            <button key={k} className={sort.key === k ? "sort-btn active" : "sort-btn"} onClick={() => toggleSort(k)}>
              {l}
              {sort.key === k && k !== "default" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
            </button>
          ))}
        </div>

        <div className="holding-table">
          <div className="holding-head">
            <span>标的</span>
            <span>市值/权重</span>
            <span>现价/成本</span>
            <span>浮动盈亏</span>
            <span>状态</span>
          </div>
          {analysis.isLoading && <p className="muted pad">加载中…</p>}
          {analysis.isError && <div className="error-state" role="alert">持仓加载失败 <button onClick={() => analysis.refetch()}>重试</button></div>}
          {!analysis.isLoading && !analysis.isError && sorted.length === 0 && <p className="empty-inline">暂无持仓，上方添加第一笔</p>}
          {sorted.map((h) => (
            <button
              key={h.id}
              className={`holding-row ${active?.id === h.id ? "active" : ""}`}
              onClick={() => setSelected(h.id)}
            >
              <span className="holding-name">
                <strong>{h.name}</strong>
                <em className="muted">{h.code} · {h.market}</em>
              </span>
              <span>
                <strong>{fmtMoney(h.marketValue)}</strong>
                <em className="muted">{fmtPct(h.weight)}</em>
              </span>
              <span>
                <strong>{h.price != null ? h.price.toFixed(3) : "无行情"}</strong>
                <em className="muted">成本 {h.cost}</em>
              </span>
              <span className={h.pnl == null ? "muted" : h.pnl >= 0 ? "up" : "down"}>
                <strong>{fmtSignedMoney(h.pnl)}</strong>
                <em>{fmtSignedPct(h.pnlPct)}</em>
              </span>
              <span className="muted">{ANALYSIS_LABEL[h.analysisStatus] ?? h.analysisStatus}</span>
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <PositionDetail
          holding={active as AnalysisHolding}
          analyzing={analyze.isPending}
          deleting={del.isPending}
          onAnalyze={() =>
            analyze.mutate(active.id, {
              onSuccess: () => setOperationNote({ text: `${active.name} 已进入分析队列`, error: false }),
              onError: (error) => setOperationNote({ text: errorDetail(error, "发起分析失败"), error: true }),
            })
          }
          onDelete={() => {
            if (confirm(`确认删除「${active.name}」？`)) {
              del.mutate(active.id, {
                onSuccess: () => {
                  setSelected(null);
                  setOperationNote({ text: `${active.name} 已删除`, error: false });
                },
                onError: (error) => setOperationNote({ text: errorDetail(error, "删除持仓失败"), error: true }),
              });
            }
          }}
        />
      ) : (
        <GlassPanel as="aside" tone="data" className="detail-panel detail-empty">选择一行查看分析详情</GlassPanel>
      )}
    </div>
  );
}

function WatchlistTab() {
  const watchlist = useWatchlist();
  const add = useAddWatchlist();
  const del = useDeleteWatchlist();
  const analyze = useAnalyzeWatchlist();
  const [selected, setSelected] = useState<string | null>(null);
  const [operationNote, setOperationNote] = useState<OperationNote | null>(null);
  const [form, setForm] = useState({ code: "", name: "", market: "A股", thesis: "" });

  const items = watchlist.data ?? [];
  const active = items.find((w) => w.id === selected) ?? items[0] ?? null;

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate(
      { code: form.code, name: form.name, market: form.market, thesis: form.thesis },
      {
        onSuccess: () => {
          setForm({ code: "", name: "", market: "A股", thesis: "" });
          setOperationNote({ text: "自选标的已添加", error: false });
        },
        onError: (error) => setOperationNote({ text: errorDetail(error, "新增自选失败"), error: true }),
      },
    );
  };

  return (
    <div className="workbench">
      <div className="workbench-main">
        <form className="inline-add-form" onSubmit={onAdd}>
          <SearchField
            value={form.code}
            onSearch={(v) => setForm({ ...form, code: v, name: "", market: "A股" })}
            onPick={(r: SearchResult) => setForm({ ...form, code: r.code, name: r.name, market: r.market })}
          />
          <input aria-label="自选名称" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="研究假设" placeholder="研究假设（可选）" value={form.thesis} onChange={(e) => setForm({ ...form, thesis: e.target.value })} />
          <button className="btn sm" type="submit" disabled={add.isPending || !form.code || !form.name}>
            {add.isPending ? "新增中…" : "新增"}
          </button>
        </form>
        {operationNote && <div className={operationNote.error ? "inline-note login-error" : "inline-note"} role={operationNote.error ? "alert" : "status"}>{operationNote.text}</div>}

        <div className="holding-table watchlist-table">
          <div className="holding-head">
            <span>标的</span>
            <span>市场</span>
            <span>状态</span>
            <span>分析</span>
          </div>
          {watchlist.isLoading && <p className="muted pad">加载中…</p>}
          {watchlist.isError && <div className="error-state" role="alert">自选加载失败 <button onClick={() => watchlist.refetch()}>重试</button></div>}
          {!watchlist.isLoading && !watchlist.isError && items.length === 0 && <p className="empty-inline">暂无自选，上方添加</p>}
          {items.map((w) => (
            <button
              key={w.id}
              className={`holding-row ${active?.id === w.id ? "active" : ""}`}
              onClick={() => setSelected(w.id)}
            >
              <span className="holding-name">
                <strong>{w.name || w.code}</strong>
                <em className="muted">{w.code}</em>
              </span>
              <span className="muted">{w.market}</span>
              <span className="muted">{w.status}</span>
              <span className="muted">{ANALYSIS_LABEL[w.analysis_status] ?? w.analysis_status}</span>
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <WatchlistDetail
          item={active as WatchlistItemView}
          analyzing={analyze.isPending}
          deleting={del.isPending}
          onAnalyze={() =>
            analyze.mutate(active.id, {
              onSuccess: () => setOperationNote({ text: `${active.name || active.code} 已进入分析队列`, error: false }),
              onError: (error) => setOperationNote({ text: errorDetail(error, "发起分析失败"), error: true }),
            })
          }
          onDelete={() => {
            if (confirm(`确认删除自选「${active.name || active.code}」？`)) {
              del.mutate(active.id, {
                onSuccess: () => {
                  setSelected(null);
                  setOperationNote({ text: `${active.name || active.code} 已删除`, error: false });
                },
                onError: (error) => setOperationNote({ text: errorDetail(error, "删除自选失败"), error: true }),
              });
            }
          }}
        />
      ) : (
        <GlassPanel as="aside" tone="data" className="detail-panel detail-empty">选择一行查看分析详情</GlassPanel>
      )}
    </div>
  );
}

function EtfsTab() {
  const indices = useMarketIndices();
  const rows = (indices.data ?? []).filter((r) => r.relatedEtfs?.length > 0);
  if (indices.isLoading) return <p className="muted pad">加载中…</p>;
  if (indices.isError) return <div className="panel error-state" role="alert">指数基金数据加载失败 <button onClick={() => indices.refetch()}>重试</button></div>;
  if (rows.length === 0) return <div className="panel empty-state">暂无指数基金关联数据</div>;
  return (
    <div className="etf-grid">
      {rows.map((r) => (
        <GlassPanel as="article" tone="data" interactive className="etf-card" key={r.code}>
          <div className="etf-card-head">
            <h3>{r.name}</h3>
            <span className={`etf-pct ${String(r.changePct ?? "").startsWith("-") ? "down" : "up"}`}>
              {formatChangePct(r.changePct)}
            </span>
          </div>
          <div className="muted etf-level">{r.level ?? "暂无"} · {r.region}</div>
          <div className="etf-related">
            <span className="detail-section-label">关联 ETF / 基金</span>
            <div className="watch-signals">
              {r.relatedEtfs.map((e) => (
                <span className="watch-signal-chip" key={e}>
                  {e}
                </span>
              ))}
            </div>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
