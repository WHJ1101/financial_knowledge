import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { GlassPanel } from "@/components/LiquidGlass";
import {
  useDeleteReport,
  useMarkRead,
  useReports,
  useToggleArchive,
  useToggleStar,
  type ReportView,
} from "@/hooks/useReports";

type Filter = "all" | "starred" | "shared" | "archived";
type ActionNote = { text: string; error: boolean };

const TYPE_LABELS: { value: string; label: string }[] = [
  { value: "all", label: "全部主题" },
  { value: "industry", label: "产业链深度" },
  { value: "market", label: "市场快览" },
  { value: "stock", label: "个股跟踪" },
  { value: "policy", label: "政策扫描" },
  { value: "custom", label: "主题调研" },
];

/** 知识库页（方案 §8.2/§11.F）：主题/来源/状态筛选 + 搜索 + 标星/归档/删除 + 导出。 */
export function KnowledgePage() {
  const reports = useReports();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") || "all") as Filter;
  const type = params.get("type") || "all";
  const origin = params.get("origin") || "all";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = 18;
  const markRead = useMarkRead();
  const star = useToggleStar();
  const archive = useToggleArchive();
  const del = useDeleteReport();
  const actionPending = markRead.isPending || star.isPending || archive.isPending || del.isPending;
  const [actionNote, setActionNote] = useState<ActionNote | null>(null);

  const actionError = (error: unknown, fallback: string) =>
    setActionNote({ text: error instanceof ApiError ? error.detail : fallback, error: true });

  const setFilterParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    let rows = reports.data ?? [];
    if (filter === "archived") rows = rows.filter((r) => r.archived);
    else rows = rows.filter((r) => !r.archived);
    if (filter === "starred") rows = rows.filter((r) => r.starred);
    if (filter === "shared") rows = rows.filter((r) => r.visibility === "shared");
    if (type !== "all") rows = rows.filter((r) => r.type === type);
    if (origin !== "all") rows = rows.filter((r) => r.origin === origin);
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(kw) ||
          r.topic.toLowerCase().includes(kw) ||
          (r.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
      );
    }
    return rows;
  }, [reports.data, filter, type, origin, q]);
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const visible = list.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  useEffect(() => {
    if (page <= pageCount) return;
    const next = new URLSearchParams(params);
    next.set("page", String(pageCount));
    setParams(next, { replace: true });
  }, [page, pageCount, params, setParams]);

  return (
    <div className="page fade-up">
      <header className="page-head knowledge-head">
        <div>
          <h1>知识库</h1>
          <p className="muted">共享研报与你的私有报告，标星、归档与已读状态仅对你生效</p>
        </div>
        <div className="knowledge-export">
          <a className="ghost-btn" href="/api/v1/export/reports.csv">导出 CSV</a>
          <a className="ghost-btn" href="/api/v1/export/reports.json">导出 JSON</a>
        </div>
      </header>

      <div className="knowledge-toolbar">
        <label className="search-label">
          <span className="sr-only">搜索报告</span>
          <input className="search" autoFocus={params.get("focus") === "search"} placeholder="搜索标题、主题或标签…" value={q} onChange={(e) => setFilterParam("q", e.target.value)} />
        </label>
        <div className="knowledge-selects">
          <select aria-label="报告类型" value={type} onChange={(e) => setFilterParam("type", e.target.value)}>
            {TYPE_LABELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select aria-label="报告来源" value={origin} onChange={(e) => setFilterParam("origin", e.target.value)}>
            <option value="all">全部来源</option>
            <option value="automation">自动化</option>
            <option value="manual">手动</option>
          </select>
        </div>
      </div>

      <div className="tab-bar inline" role="tablist" aria-label="报告状态">
        {(
          [
            ["all", "全部"],
            ["starred", "标星"],
            ["shared", "共享"],
            ["archived", "归档"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button role="tab" aria-selected={filter === key} key={key} className={filter === key ? "tab active" : "tab"} onClick={() => setFilterParam("filter", key)}>
            {label}
          </button>
        ))}
      </div>

      {reports.isLoading && <p className="muted">加载中…</p>}
      {reports.isError && <div className="panel error-state" role="alert">报告加载失败 <button onClick={() => reports.refetch()}>重试</button></div>}
      {actionNote && <div className={actionNote.error ? "inline-note login-error" : "inline-note"} role={actionNote.error ? "alert" : "status"}>{actionNote.text}</div>}
      {list.length === 0 && !reports.isLoading && !reports.isError && <div className="panel empty-state">没有符合条件的报告</div>}

      <div className="report-grid">
        {visible.map((r) => (
          <ReportCard
            key={r.id}
            r={r}
            busy={actionPending}
            onStar={() => star.mutate(r.id, {
              onError: (error) => actionError(error, "标星操作失败"),
            })}
            onRead={() => markRead.mutate(r.id, {
              onError: (error) => actionError(error, "已读状态保存失败"),
            })}
            onArchive={() => archive.mutate(r.id, {
              onError: (error) => actionError(error, "归档操作失败"),
            })}
            onDelete={() => {
              if (confirm(`确认删除「${r.title}」？该操作不可撤销。`)) {
                del.mutate(r.id, {
                  onSuccess: () => setActionNote({ text: `「${r.title}」已删除`, error: false }),
                  onError: (error) => actionError(error, "报告删除失败"),
                });
              }
            }}
          />
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="pagination" aria-label="报告分页">
          <button className="ghost-btn" disabled={page <= 1} onClick={() => setFilterParam("page", String(page - 1))}>上一页</button>
          <span>{page} / {pageCount}</span>
          <button className="ghost-btn" disabled={page >= pageCount} onClick={() => setFilterParam("page", String(page + 1))}>下一页</button>
        </nav>
      )}
    </div>
  );
}

function ReportCard({
  r,
  busy,
  onStar,
  onRead,
  onArchive,
  onDelete,
}: {
  r: ReportView;
  busy: boolean;
  onStar: () => void;
  onRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <GlassPanel as="article" tone="data" interactive className="report-card">
      <div className="report-card-head">
        <span className={r.visibility === "shared" ? "badge badge-neutral" : "badge badge-gap"}>
          {r.visibility === "shared" ? "共享" : "私有"}
        </span>
        {r.type_label && <span className="report-type">{r.type_label}</span>}
        {r.origin && <span className="badge badge-neutral">{r.origin === "automation" ? "自动化" : "手动"}</span>}
        {!r.read && <span className="unread-dot" title="未读" />}
      </div>
      <h3 className="report-card-title">
        {r.content_status === "ok" ? (
          <Link to={`/reports/${encodeURIComponent(r.id)}`} className="report-card-link">{r.title}</Link>
        ) : <span>{r.title}</span>}
      </h3>
      <p className="report-card-topic">{r.topic}</p>
      {r.summary && <p className="report-card-summary muted">{r.summary}</p>}
      {r.content_status !== "ok" && <div className="login-error" role="status">报告正文缺失，元数据已保留等待修复</div>}
      <div className="report-card-foot">
        <span className="muted report-date">{r.local_date ?? r.created_at.slice(0, 10)}</span>
        <div className="report-actions">
          <button disabled={busy} aria-label={r.starred ? `取消标星 ${r.title}` : `标星 ${r.title}`} className={r.starred ? "icon-btn on" : "icon-btn"} onClick={onStar}>
            {r.starred ? "★" : "☆"}
          </button>
          {!r.read && (
            <button disabled={busy} className="icon-btn" onClick={onRead}>
              标记已读
            </button>
          )}
          <button disabled={busy} className="icon-btn" onClick={onArchive}>
            {r.archived ? "取消归档" : "归档"}
          </button>
          {r.is_owner && (
            <button disabled={busy} className="icon-btn danger" onClick={onDelete}>
              删除
            </button>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
