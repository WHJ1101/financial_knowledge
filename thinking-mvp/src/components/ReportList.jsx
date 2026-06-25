import { post } from "../api.js";
import { refresh, showToast } from "../store.js";

export function ReportList({ reports, emptyText = "暂无报告" }) {
  if (!reports.length) return <div class="empty-state"><p>{emptyText}</p></div>;

  const handleStar = async (e, id) => {
    e.stopPropagation();
    await post(`/api/reports/${encodeURIComponent(id)}/star`);
    await refresh();
  };

  const handleArchive = async (e, id) => {
    e.stopPropagation();
    await post(`/api/reports/${encodeURIComponent(id)}/archive`);
    await refresh();
    showToast("归档状态已切换");
  };

  return (
    <div class="report-list">
      {reports.map(r => (
        <article key={r.id} class="report-row">
          <span class="report-status">{r.status === "read" ? "已读" : "新"}</span>
          <div class="report-title">
            <a href={`#report/${encodeURIComponent(r.id)}`}>{r.title}</a>
            <code>{r.typeLabel} · {r.localDate}</code>
          </div>
          <div class="report-chips">
            <button class={`star-btn ${r.starred ? "starred" : ""}`} onClick={(e) => handleStar(e, r.id)} title="标星">★</button>
            <button class={`star-btn ${r.archived ? "starred" : ""}`} onClick={(e) => handleArchive(e, r.id)} title={r.archived ? "取消归档" : "归档"} style="font-size:13px">📦</button>
            <span class="origin-chip" data-origin={r.origin}>{r.originLabel}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
