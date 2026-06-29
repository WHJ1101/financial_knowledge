import { useEffect, useState } from "preact/hooks";
import { reports, refresh } from "../store.js";
import { post, get } from "../api.js";

export function ReportReader({ id }) {
  const [report, setReport] = useState(null);

  useEffect(() => {
    (async () => {
      let r = reports.value.find(item => item.id === id);
      if (!r) { const data = await get(`/api/reports/${encodeURIComponent(id)}`); r = data.report; }
      if (r && r.status !== "read") { await post(`/api/reports/${encodeURIComponent(r.id)}`, {}); await refresh(); }
      setReport(r);
    })();
  }, [id]);

  if (!report) return <div class="nav-page"><p>加载中...</p></div>;

  const reportUrl = `/reports/${report.file.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <section class="reader-page">
      <div class="reader-toolbar">
        <a href="#today" class="back-link">← 返回</a>
        <a class="ghost-button" href={reportUrl} target="_blank" rel="noreferrer">打开网页报告</a>
      </div>
      <div class="reader-title">
        <p>{report.originLabel} · {report.typeLabel} · {report.localDate}</p>
        <h1>{report.title}</h1>
      </div>
      <iframe src={reportUrl} title="报告预览" id="reportFrame" />
    </section>
  );
}
