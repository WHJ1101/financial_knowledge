import { useEffect, useState } from "preact/hooks";
import { reports, loadReports, loadStatus, showToast } from "../store.js";
import { del, get, post } from "../api.js";

export function ReportReader({ id }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  const reloadReports = async () => {
    await Promise.allSettled([loadReports(), loadStatus()]);
  };

  useEffect(() => {
    setError("");
    setReport(null);
    (async () => {
      try {
        let r = reports.value.find(item => item.id === id);
        if (!r) { const data = await get(`/api/reports/${encodeURIComponent(id)}`); r = data.report; }
        if (r && r.status !== "read") { await post(`/api/reports/${encodeURIComponent(r.id)}`, {}); await reloadReports(); }
        setReport(r);
      } catch (err) {
        setError(err.message || "报告加载失败");
      }
    })();
  }, [id]);

  const handleDelete = async () => {
    if (!report) return;
    if (!globalThis.confirm("确定删除报告「" + report.title + "」？此操作会同时移除网页报告文件。")) return;
    try {
      await del("/api/reports/" + encodeURIComponent(report.id));
      await reloadReports();
      showToast("报告已删除");
      location.hash = "#knowledge";
    } catch (err) {
      showToast("删除失败：" + err.message);
    }
  };

  if (error) return (
    <div class="nav-page">
      <div class="reader-toolbar"><a href="#today" class="back-link">← 返回</a></div>
      <div class="empty-state"><p>报告加载失败：{error}</p></div>
    </div>
  );
  if (!report) return <div class="nav-page"><p>加载中...</p></div>;

  const reportUrl = `/reports/${report.file.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <section class="reader-page">
      <div class="reader-toolbar">
        <a href="#today" class="back-link">← 返回</a>
        <a class="ghost-button" href={reportUrl} target="_blank" rel="noreferrer">打开网页报告</a>
        <button class="ghost-button danger" type="button" onClick={handleDelete}>删除报告</button>
      </div>
      <div class="reader-title">
        <p>{report.originLabel} · {report.typeLabel} · {report.localDate}</p>
        <h1>{report.title}</h1>
      </div>
      <iframe src={reportUrl} title="报告预览" id="reportFrame" />
    </section>
  );
}
