import { del, post } from "../api.js";
import { loadReports, loadStatus, showToast } from "../store.js";
import { confirmArchive, confirmDelete } from "../lib/confirm.js";

export function ReportList({ reports, emptyText = "暂无报告" }) {
  if (!reports.length) return <div class="empty-state"><p>{emptyText}</p></div>;

  const reloadReports = async () => {
    await Promise.allSettled([loadReports(), loadStatus()]);
  };

  const handleStar = async (e, id) => {
    e.stopPropagation();
    try {
      await post(`/api/reports/${encodeURIComponent(id)}/star`);
      await reloadReports();
    } catch (err) { showToast(`标星失败：${err.message}`); }
  };

  const handleArchive = async (e, report) => {
    e.stopPropagation();
    if (!report.archived && !confirmArchive(report.title)) return;
    try {
      await post(`/api/reports/${encodeURIComponent(report.id)}/archive`);
      await reloadReports();
      showToast("归档状态已切换");
    } catch (err) { showToast(`归档失败：${err.message}`); }
  };

  const handleDelete = async (e, report) => {
    e.stopPropagation();
    if (!confirmDelete(report.title, "此操作会同时移除网页报告文件。")) return;
    try {
      await del("/api/reports/" + encodeURIComponent(report.id));
      await reloadReports();
      showToast("报告已删除");
    } catch (err) { showToast("删除失败：" + err.message); }
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
            <button class={"star-btn " + (r.archived ? "starred" : "")} onClick={(e) => handleArchive(e, r)} title={r.archived ? "取消归档" : "归档"}>📦</button>
            <button class="star-btn danger" onClick={(e) => handleDelete(e, r)} title="删除报告">删</button>
            <span class="origin-chip" data-origin={r.origin}>{r.originLabel}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
