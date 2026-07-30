import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { BottomSheet } from "@/components/mobile/BottomSheet";
import { LongPressMenu } from "@/components/mobile/LongPressMenu";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { Snackbar } from "@/components/mobile/Snackbar";
import { SwipeActionRow } from "@/components/mobile/SwipeActionRow";
import { useSession } from "@/hooks/useAuth";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import {
  useLatestSignalSync,
  useRetrySignalSync,
  useSetSignalState,
  useSignals,
  useSyncSignals,
  type SignalSyncRun,
  type SignalView,
} from "@/hooks/useSignals";

type Filter = "all" | "unread" | "confirmed" | "high";

const CONFIDENCE_LABEL: Record<string, string> = { low: "低置信", medium: "中置信", high: "高置信" };

function statusClass(v: string): string {
  if (v === "已验证") return "verified";
  if (v === "已证伪") return "rejected";
  return "pending";
}

/** 信号源页（方案 §8.2/§4.4/§11.5）：公共信号 + 个人确认/忽略态 + 飞书同步（超管）。 */
export function SignalsPage() {
  const session = useSession();
  const isSuperadmin = session.data?.user?.role === "superadmin";
  const capabilities = useInputCapabilities();
  const signals = useSignals();
  const setState = useSetSignalState();
  const sync = useSyncSignals();
  const latestSync = useLatestSignalSync(isSuperadmin);
  const retrySync = useRetrySignalSync();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [undo, setUndo] = useState<{
    signalId: string;
    previous: SignalView["state"];
    message: string;
  } | null>(null);
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

  const onSync = (mode: "incremental" | "backfill" = "incremental") => {
    sync.mutate({
      mode,
      date_from: mode === "backfill" ? dateFrom : null,
      date_to: mode === "backfill" ? dateTo : null,
    }, {
      onSuccess: (r) =>
        {
          setNote({ text: `飞书同步已入队：${r.run_id}`, error: false });
          setShowBackfill(false);
        },
      onError: (e) => setNote({ text: e instanceof ApiError ? `同步失败：${e.detail}` : "同步失败", error: true }),
    });
  };

  const updateSignalState = (signal: SignalView, state: SignalView["state"]) => {
    setState.mutate(
      { id: signal.id, state },
      {
        onSuccess: () => {
          setNote({ text: state === "ignored" ? "信号已忽略" : "信号状态已更新", error: false });
          setUndo({
            signalId: signal.id,
            previous: signal.state,
            message: state === "ignored" ? "已忽略信号" : "已确认信号",
          });
        },
        onError: (error) => setNote({
          text: error instanceof ApiError ? error.detail : "状态更新失败",
          error: true,
        }),
      },
    );
  };

  useEffect(() => {
    const status = latestSync.data?.status;
    if (status === "succeeded" || status === "partial") signals.refetch();
  }, [latestSync.data?.id, latestSync.data?.status]);

  return (
    <div className="page fade-up">
      <header className="page-head signals-head">
        <div>
          <h1>信号源</h1>
          <p className="muted">沉淀飞书社群、私域反馈与一线线索，确认与忽略状态仅对你生效</p>
        </div>
        {isSuperadmin && (
          <div className="task-actions">
            <GlassButton tone="utility" onClick={() => setShowBackfill(true)}>
              日期回补
            </GlassButton>
            <GlassButton tone="primary" refraction onClick={() => onSync()} disabled={sync.isPending}>
              {sync.isPending ? "正在入队…" : "增量同步"}
            </GlassButton>
          </div>
        )}
      </header>

      {note && <div className={note.error ? "inline-note login-error" : "inline-note"} role={note.error ? "alert" : "status"}>{note.text}</div>}
      {isSuperadmin && <SignalSyncStatus run={latestSync.data ?? null} loading={latestSync.isLoading} onRetry={() => latestSync.data && retrySync.mutate(latestSync.data.id)} retrying={retrySync.isPending} />}

      <PullToRefresh
        disabled={!capabilities.isMobile}
        onRefresh={() => Promise.all([
          signals.refetch(),
          ...(isSuperadmin ? [latestSync.refetch()] : []),
        ])}
      >
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
      {signals.isError && <div className="panel error-state" role="alert">信号加载失败 <GlassButton tone="text" size="sm" onClick={() => signals.refetch()}>重试</GlassButton></div>}
      {list.length === 0 && !signals.isLoading && !signals.isError && (
        <div className="panel empty-state">暂无社群信号。{isSuperadmin ? "点击“同步飞书”读取授权文档抽取信号。" : ""}</div>
      )}

      <div className="signal-list">
        {visible.map((s) => (
          <SwipeActionRow
            key={s.id}
            leadingLabel="确认"
            trailingLabel="忽略"
            onLeading={() => updateSignalState(s, "confirmed")}
            onTrailing={() => updateSignalState(s, "ignored")}
          >
            <SignalRow
              signal={s}
              pending={setState.isPending}
              onSet={(state) => updateSignalState(s, state)}
            />
          </SwipeActionRow>
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="pagination" aria-label="信号分页">
          <GlassButton tone="utility" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</GlassButton>
          <span>{Math.min(page, pageCount)} / {pageCount}</span>
          <GlassButton tone="utility" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</GlassButton>
        </nav>
      )}
      </PullToRefresh>
      <BottomSheet
        open={showBackfill}
        title="回补飞书信号"
        onClose={() => setShowBackfill(false)}
        height="compact"
        className="signal-backfill-sheet"
      >
          <div className="signal-backfill-dialog">
            <p className="muted">选择最多 90 天。Worker 会逐日比对 section 指纹，只处理发生变化的内容。</p>
            <label>
              开始日期
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              结束日期
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <div className="task-actions">
              <GlassButton tone="utility" onClick={() => setShowBackfill(false)}>取消</GlassButton>
              <GlassButton tone="primary" disabled={!dateFrom || !dateTo || sync.isPending} onClick={() => onSync("backfill")}>
                {sync.isPending ? "正在入队…" : "开始回补"}
              </GlassButton>
            </div>
          </div>
      </BottomSheet>
      <Snackbar
        open={undo !== null}
        message={undo?.message ?? ""}
        actionLabel="撤销"
        onClose={() => setUndo(null)}
        onAction={() => {
          if (!undo) return;
          setState.mutate(
            { id: undo.signalId, state: undo.previous },
            { onSettled: () => setUndo(null) },
          );
        }}
      />
    </div>
  );
}

const SYNC_STATUS: Record<SignalSyncRun["status"], string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  canceled: "已取消",
};

function SignalSyncStatus({
  run,
  loading,
  onRetry,
  retrying,
}: {
  run: SignalSyncRun | null;
  loading: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (loading) return <p className="muted">同步状态加载中…</p>;
  if (!run) return <div className="inline-note">尚无飞书同步运行。增量同步会扫描全部 section 并跳过未变化内容。</div>;
  const noChange = run.status === "succeeded" && run.changed_count === 0;
  return (
    <GlassPanel as="section" tone="data" className="signal-sync-status">
      <div className="task-card-head">
        <div>
          <strong>最近同步 · {SYNC_STATUS[run.status]}</strong>
          <p className="muted">
            {noChange
              ? `已扫描 ${run.scanned_count} 个 section，内容无变化`
              : `扫描 ${run.scanned_count} · 变化 ${run.changed_count} · 新版本 ${run.written_count} · 失败 ${run.failed_count}`}
          </p>
        </div>
        <span className={run.status === "failed" ? "badge badge-danger" : "badge badge-neutral"}>
          {run.stage ?? "等待 Worker"}
        </span>
      </div>
      {run.error_message && <p className="login-error">{run.error_message}</p>}
      {(run.status === "partial" || run.status === "failed") && (
        <GlassButton tone="secondary" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? "正在入队…" : "重试失败日期"}
        </GlassButton>
      )}
    </GlassPanel>
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
    <GlassPanel as="article" tone="data" interactive className="signal-card">
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
        <LongPressMenu
          title="信号来源"
          trigger={(
            <div className="signal-src-line muted">
              <span>{signal.source_title || "飞书知识源"}</span>
              {signal.source_url && (
                <a href={signal.source_url} target="_blank" rel="noreferrer" className="signal-src-link">
                  打开来源
                </a>
              )}
            </div>
          )}
        >
          <div className="signal-source-sheet">
            <strong>{signal.source_title || "飞书知识源"}</strong>
            <p className="muted">{signal.date} · 版本 {signal.version_no}</p>
            {signal.source_url && (
              <a href={signal.source_url} target="_blank" rel="noreferrer" className="glass-button glass-button-utility">
                打开原始来源
              </a>
            )}
          </div>
        </LongPressMenu>
      </div>
      <div className="signal-actions">
        <GlassButton tone="utility" size="sm" onClick={() => onSet("confirmed")} disabled={pending || signal.state === "confirmed"}>
          确认
        </GlassButton>
        <GlassButton tone="text" size="sm" onClick={() => onSet("ignored")} disabled={pending}>
          忽略
        </GlassButton>
      </div>
    </GlassPanel>
  );
}
