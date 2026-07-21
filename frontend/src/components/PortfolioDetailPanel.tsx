/** 持仓/自选详情面板（移植 PortfolioDetailPanel.jsx，方案 §11.4/§11.F）。
 * 持仓：市值/现价/成本/盈亏 mini 指标 + 编辑股数成本 + 手动行情覆盖 + AI 分析 + 关联报告。
 * 自选：状态 + AI 分析（关注理由/建议/风险）+ 观察信号 + 关联报告。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { GlassPanel } from "@/components/LiquidGlass";
import { useSession } from "@/hooks/useAuth";
import type { AnalysisHolding } from "@/hooks/useMarket";
import {
  useAssetReports,
  useDeleteQuoteOverride,
  useUpsertQuoteOverride,
} from "@/hooks/useMarket";
import type { PositionAnalysisDetail, WatchlistItemView } from "@/hooks/usePortfolio";
import { useUpdatePosition } from "@/hooks/usePortfolio";

function fmtMoney(v: number | null | undefined, d = 2): string {
  if (v == null) return "暂无";
  return `¥${v.toFixed(d)}`;
}
function fmtSignedMoney(v: number | null | undefined): string {
  if (v == null) return "暂无";
  return `${v >= 0 ? "+" : ""}¥${v.toFixed(0)}`;
}
function fmtSignedPct(v: number | null | undefined): string {
  return v == null ? "暂无" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const ANALYSIS_LABEL: Record<string, string> = {
  pending: "待分析",
  analyzing: "分析中",
  done: "已分析",
  failed: "分析失败",
};

function PositionEvidenceDetail({ detail }: { detail: PositionAnalysisDetail | undefined }) {
  if (!detail || Object.keys(detail).length === 0) return null;
  const sections = [
    ["走势", detail.trend],
    ["基金与基本面", detail.fundamentals],
    ["宏观", detail.macro],
    ["主题与简报", detail.theme_news],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <section className="position-evidence" aria-label="持仓分析证据">
      {sections.length > 0 && (
        <div className="position-evidence-grid">
          {sections.map(([label, text]) => (
            <article className="position-evidence-item" key={label}>
              <h3>{label}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      )}
      {detail.triggers && detail.triggers.length > 0 && (
        <div className="position-evidence-block">
          <h3>触发条件</h3>
          <ul>
            {detail.triggers.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      {detail.evidence_used && detail.evidence_used.length > 0 && (
        <div className="position-evidence-block">
          <h3>已引用证据</h3>
          <div className="position-evidence-sources">
            {detail.evidence_used.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
      )}
      {detail.data_gaps && detail.data_gaps.length > 0 && (
        <div className="position-evidence-gaps">
          <h3>数据缺口</h3>
          <ul>
            {detail.data_gaps.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function RelatedReports({ code }: { code: string }) {
  const q = useAssetReports(code);
  if (q.isLoading) return <p className="muted">关联报告加载中…</p>;
  if (q.isError) {
    return (
      <div className="error-state" role="alert">
        关联报告加载失败 <button onClick={() => q.refetch()}>重试</button>
      </div>
    );
  }
  if (!q.data?.length) return null;
  return (
    <div className="detail-related">
      <span className="detail-section-label">关联报告</span>
      {q.data.map((l) => (
        <Link key={l.id} to={`/reports/${encodeURIComponent(l.report.id)}`} className="detail-related-item">
          {l.report.title}
        </Link>
      ))}
    </div>
  );
}

export function PositionDetail({
  holding,
  onAnalyze,
  onDelete,
  analyzing = false,
  deleting = false,
}: {
  holding: AnalysisHolding;
  onAnalyze: () => void;
  onDelete: () => void;
  analyzing?: boolean;
  deleting?: boolean;
}) {
  const update = useUpdatePosition();
  const session = useSession();
  const canManageQuotes = session.data?.user?.role === "superadmin";
  const upsertQuote = useUpsertQuoteOverride();
  const deleteQuote = useDeleteQuoteOverride();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [form, setForm] = useState({ shares: String(holding.shares), cost: String(holding.cost) });
  const [quote, setQuote] = useState({ price: "", changePct: "", note: "" });

  useEffect(() => {
    setEditing(false);
    setForm({ shares: String(holding.shares), cost: String(holding.cost) });
    setQuote({ price: "", changePct: "", note: "" });
    setNote(null);
  }, [holding.id, holding.price]);

  const isManual = holding.quoteSource === "手动行情";

  return (
    <GlassPanel as="aside" tone="data" className="detail-panel">
      <div className="detail-title">
        <h2>{holding.name}</h2>
        <p className="muted">
          {holding.code} · {holding.market} · {holding.shares} 股
        </p>
      </div>

      <div className="detail-metrics">
        <div className="mini-metric">
          <span>市值</span>
          <strong>{fmtMoney(holding.marketValue, 0)}</strong>
        </div>
        <div className="mini-metric">
          <span>{holding.quoteSource || "现价"}</span>
          <strong>{holding.price != null ? fmtMoney(holding.price, 3) : "无行情"}</strong>
        </div>
        <div className="mini-metric">
          <span>成本</span>
          <strong>{fmtMoney(holding.cost, 3)}</strong>
        </div>
        <div className={`mini-metric ${holding.pnl == null ? "" : holding.pnl >= 0 ? "up" : "down"}`}>
          <span>盈亏</span>
          <strong>
            {holding.pnl == null ? "待补成本" : `${fmtSignedMoney(holding.pnl)} / ${fmtSignedPct(holding.pnlPct)}`}
          </strong>
        </div>
      </div>

      {editing ? (
        <form
          className="detail-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { id: holding.id, shares: Number(form.shares), cost: Number(form.cost) },
              {
                onSuccess: () => {
                  setEditing(false);
                  setNote({ text: "持仓已更新", error: false });
                },
                onError: (error) =>
                  setNote({
                    text: error instanceof ApiError ? error.detail : "持仓更新失败",
                    error: true,
                  }),
              },
            );
          }}
        >
          <label>
            <span>数量</span>
            <input type="number" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} />
          </label>
          <label>
            <span>成本价</span>
            <input type="number" step="0.001" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </label>
          <div className="detail-edit-actions">
            <button className="btn sm" type="submit" disabled={update.isPending}>
              {update.isPending ? "保存中…" : "保存"}
            </button>
            <button className="ghost-btn sm" type="button" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </form>
      ) : canManageQuotes ? (
        <form
          className="detail-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quote.price) return;
            upsertQuote.mutate(
              {
                code: holding.code,
                name: holding.name,
                market: holding.market,
                price: Number(quote.price),
                changePct: quote.changePct || undefined,
                note: quote.note || undefined,
              },
              {
                onSuccess: () => setNote({ text: "手动行情已保存", error: false }),
                onError: (error) =>
                  setNote({
                    text: error instanceof ApiError ? error.detail : "行情保存失败",
                    error: true,
                  }),
              },
            );
          }}
        >
          <div className="detail-section-label">手动行情覆盖</div>
          <label>
            <span>手动现价</span>
            <input type="number" step="0.0001" value={quote.price} onChange={(e) => setQuote({ ...quote, price: e.target.value })} />
          </label>
          <div className="detail-edit-actions">
            <button className="btn sm" type="submit" disabled={upsertQuote.isPending || !quote.price}>
              {upsertQuote.isPending ? "保存中…" : "保存行情"}
            </button>
            {isManual && (
              <button
                className="ghost-btn sm"
                type="button"
                onClick={() =>
                  deleteQuote.mutate(holding.code, {
                    onSuccess: () => setNote({ text: "手动行情已清除", error: false }),
                    onError: (error) =>
                      setNote({
                        text: error instanceof ApiError ? error.detail : "清除行情失败",
                        error: true,
                      }),
                  })
                }
                disabled={deleteQuote.isPending}
              >
                {deleteQuote.isPending ? "清除中…" : "清除"}
              </button>
            )}
          </div>
        </form>
      ) : null}

      {note && (
        <div className={note.error ? "inline-note login-error" : "inline-note"} role={note.error ? "alert" : "status"}>
          {note.text}
        </div>
      )}

      <div className="detail-analysis">
        <div className="detail-section-label">AI 分析 · {ANALYSIS_LABEL[holding.analysisStatus] ?? holding.analysisStatus}</div>
        {holding.reason ? (
          <p className="detail-analysis-text">{holding.reason}</p>
        ) : (
          <p className="muted">{holding.analysisStatus === "analyzing" ? "AI 正在整理投研要点…" : "暂无分析内容"}</p>
        )}
        <PositionEvidenceDetail detail={holding.analysisDetail} />
        {holding.risk && <p className="detail-analysis-risk">风险：{holding.risk}</p>}
      </div>

      <RelatedReports code={holding.code} />

      <div className="detail-actions">
        {!editing && (
          <button className="ghost-btn sm" onClick={() => setEditing(true)}>
            编辑持仓
          </button>
        )}
        <button className="ghost-btn sm" onClick={onAnalyze} disabled={analyzing || holding.analysisStatus === "analyzing"}>
          {analyzing ? "入队中…" : "重新分析"}
        </button>
        <button className="ghost-btn sm danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "删除中…" : "删除持仓"}
        </button>
      </div>
    </GlassPanel>
  );
}

export function WatchlistDetail({
  item,
  onAnalyze,
  onDelete,
  analyzing = false,
  deleting = false,
}: {
  item: WatchlistItemView;
  onAnalyze: () => void;
  onDelete: () => void;
  analyzing?: boolean;
  deleting?: boolean;
}) {
  return (
    <GlassPanel as="aside" tone="data" className="detail-panel">
      <div className="detail-title">
        <h2>{item.name || item.code}</h2>
        <p className="muted">
          {item.code} · {item.market} · {item.status}
        </p>
      </div>

      <div className="detail-analysis">
        <div className="detail-section-label">AI 分析 · {ANALYSIS_LABEL[item.analysis_status] ?? item.analysis_status}</div>
        {item.thesis && (
          <p className="detail-analysis-text">
            <b>关注理由：</b>
            {item.thesis}
          </p>
        )}
        {item.advice && (
          <p className="detail-analysis-text">
            <b>建议：</b>
            {item.advice}
          </p>
        )}
        {item.risk && <p className="detail-analysis-risk">风险：{item.risk}</p>}
        {!item.thesis && !item.advice && (
          <p className="muted">{item.analysis_status === "analyzing" ? "AI 正在整理…" : "暂无分析内容"}</p>
        )}
      </div>

      {item.watch_signals?.length > 0 && (
        <div className="detail-related">
          <span className="detail-section-label">观察信号</span>
          <div className="watch-signals">
            {item.watch_signals.map((s) => (
              <span className="watch-signal-chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <RelatedReports code={item.code} />

      <div className="detail-actions">
        <button className="ghost-btn sm" onClick={onAnalyze} disabled={analyzing || item.analysis_status === "analyzing"}>
          {analyzing ? "入队中…" : "重新分析"}
        </button>
        <button className="ghost-btn sm danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "删除中…" : "删除自选"}
        </button>
      </div>
    </GlassPanel>
  );
}
