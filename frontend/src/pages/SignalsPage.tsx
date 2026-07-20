import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { useSession } from "@/hooks/useAuth";
import { useSetSignalState, useSignals, useSyncSignals, type SignalView } from "@/hooks/useSignals";

type Filter = "all" | "unread" | "confirmed" | "high";

const CONFIDENCE_LABEL: Record<string, string> = { low: "低置信", medium: "中置信", high: "高置信" };

function statusClass(v: string): string {
  if (v === "已验证") return "verified";
  if (v === "已证伪") return "rejected";
  return "pending";
}

/** 信号源页（方案 §8.2/§4.4/§11.5）：公共信号 + 个人确认/忽略态 + 飞书同步（超管）。 */
export function SignalsPage() {
  const signals = useSignals();
  const setState = useSetSignalState();
  const sync = useSyncSignals();
  const session = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const isSuperadmin = session.data?.user?.role === "superadmin";

  const rows = signals.data ?? [];
  const stats = useMemo(
    () => ({
      total: rows.length,
      high: rows.filter((s) => s.importance >= 4).length,
      pending: rows.filter((s) => s.verification_status === "待验证").length,
      confirmed: rows.filter((s) => s.state === "confirmed").length,
    }),
    [rows],
  );

  const list = rows.filter((s) => {
    if (filter === "unread") return s.state === "unread";
    if (filter === "confirmed") return s.state === "confirmed";
    if (filter === "high") return s.importance >= 4 && s.state !== "ignored";
    return s.state !== "ignored"; // all：隐藏已忽略
  });
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const visible = list.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  const onSync = () => {
    sync.mutate(undefined, {
      onSuccess: (r) =>
        setNote({ text: r.skipped ? r.reason : `已同步 ${r.written} 条信号（${r.processed_dates.length} 天）`, error: false }),
      onError: (e) => setNote({ text: e instanceof ApiError ? `同步失败：${e.detail}` : "同步失败", error: true }),
    });
  };

  return (
    <div className="page fade-up">
      <header className="page-head signals-head">
        <div>
          <h1>信号源</h1>
          <p className="muted">沉淀飞书社群、私域反馈与一线线索，确认与忽略状态仅对你生效</p>
        </div>
        {isSuperadmin && (
          <button className="ghost-btn" onClick={onSync} disabled={sync.isPending}>
            {sync.isPending ? "同步中…" : "同步飞书"}
          </button>
        )}
      </header>

      {note && <div className={note.error ? "inline-note login-error" : "inline-note"} role={note.error ? "alert" : "status"}>{note.text}</div>}

      <section className="stat-row">
        <div className="stat-cell">
          <span className="stat-num">{signals.isSuccess ? stats.total : "暂无"}</span>
          <span className="muted">信号总数</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{signals.isSuccess ? stats.high : "暂无"}</span>
          <span className="muted">高优先级</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{signals.isSuccess ? stats.pending : "暂无"}</span>
          <span className="muted">待验证</span>
        </div>
        <div className="stat-cell">
          <span className="stat-num">{signals.isSuccess ? stats.confirmed : "暂无"}</span>
          <span className="muted">已确认</span>
        </div>
      </section>

      <div className="tab-bar" role="tablist" aria-label="信号筛选">
        {(
          [
            ["all", "全部"],
            ["unread", "未读"],
            ["high", "高优先级"],
            ["confirmed", "已确认"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button role="tab" aria-selected={filter === key} key={key} className={filter === key ? "tab active" : "tab"} onClick={() => { setFilter(key); setPage(1); }}>
            {label}
          </button>
        ))}
      </div>

      {signals.isLoading && <p className="muted pad">加载中…</p>}
      {signals.isError && <div className="panel error-state" role="alert">信号加载失败 <button onClick={() => signals.refetch()}>重试</button></div>}
      {list.length === 0 && !signals.isLoading && !signals.isError && (
        <div className="panel empty-state">暂无社群信号。{isSuperadmin ? "点击“同步飞书”读取授权文档抽取信号。" : ""}</div>
      )}

      <div className="signal-list">
        {visible.map((s) => (
          <SignalRow
            key={s.id}
            signal={s}
            pending={setState.isPending}
            onSet={(state) =>
              setState.mutate(
                { id: s.id, state },
                {
                  onSuccess: () => setNote({ text: state === "ignored" ? "信号已忽略" : "信号状态已更新", error: false }),
                  onError: (error) => setNote({ text: error instanceof ApiError ? error.detail : "状态更新失败", error: true }),
                },
              )
            }
          />
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="pagination" aria-label="信号分页">
          <button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
          <span>{Math.min(page, pageCount)} / {pageCount}</span>
          <button className="ghost-btn" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </nav>
      )}
    </div>
  );
}

function SignalRow({
  signal,
  pending,
  onSet,
}: {
  signal: SignalView;
  pending: boolean;
  onSet: (s: SignalView["state"]) => void;
}) {
  return (
    <article className="panel signal-card">
      <div className="signal-score">
        <strong>{signal.importance}</strong>
        <span>/5</span>
      </div>
      <div className="signal-main">
        <div className="signal-card-head">
          {signal.summary && <strong className="signal-summary">{signal.summary}</strong>}
          <span className={`signal-status ${statusClass(signal.verification_status)}`}>
            {signal.verification_status}
          </span>
          {signal.state === "confirmed" && <span className="badge badge-bear">已确认</span>}
        </div>
        {signal.evidence && <p className="signal-evidence muted">{signal.evidence}</p>}
        <div className="signal-tags">
          <span>{signal.date}</span>
          {signal.theme && <span>{signal.theme}</span>}
          {signal.signal_type && <span>{signal.signal_type}</span>}
          <span>{CONFIDENCE_LABEL[signal.confidence] ?? signal.confidence}</span>
          {signal.related_assets.slice(0, 5).map((a) => (
            <span key={a} className="asset-chip">
              {a}
            </span>
          ))}
        </div>
        <div className="signal-src-line muted">
          <span>{signal.source_title || "飞书知识源"}</span>
          {signal.source_url && (
            <a href={signal.source_url} target="_blank" rel="noreferrer" className="signal-src-link">
              打开来源
            </a>
          )}
        </div>
      </div>
      <div className="signal-actions">
        <button className="ghost-btn sm" onClick={() => onSet("confirmed")} disabled={pending || signal.state === "confirmed"}>
          确认
        </button>
        <button className="link-action" onClick={() => onSet("ignored")} disabled={pending}>
          忽略
        </button>
      </div>
    </article>
  );
}
