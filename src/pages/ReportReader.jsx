import { useEffect, useState } from "preact/hooks";
import { reports, loadReports, loadStatus, showToast } from "../store.js";
import { del, get, post } from "../api.js";
import { confirmDelete, confirmDanger } from "../lib/confirm.js";

export function ReportReader({ id }) {
  const [report, setReport] = useState(null);
  const [assetLinks, setAssetLinks] = useState([]);
  const [assetForm, setAssetForm] = useState({ code: "", name: "", market: "A股" });
  const [savingAsset, setSavingAsset] = useState(false);
  const [error, setError] = useState("");

  const reloadReports = async () => {
    await Promise.allSettled([loadReports(), loadStatus()]);
  };

  const loadAssetLinks = async (reportId) => {
    const data = await get("/api/reports/" + encodeURIComponent(reportId) + "/assets");
    setAssetLinks(data.assets || []);
  };

  useEffect(() => {
    let cancelled = false;
    setError("");
    setReport(null);
    setAssetLinks([]);
    (async () => {
      try {
        let r = reports.value.find(item => item.id === id);
        if (!r) { const data = await get("/api/reports/" + encodeURIComponent(id)); r = data.report; }
        if (r && r.status !== "read") { await post("/api/reports/" + encodeURIComponent(r.id), {}); await reloadReports(); }
        if (cancelled) return;
        setReport(r);
        if (r) await loadAssetLinks(r.id);
      } catch (err) {
        if (!cancelled) setError(err.message || "报告加载失败");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleDelete = async () => {
    if (!report) return;
    if (!confirmDelete(report.title, "此操作会同时移除网页报告文件。")) return;
    try {
      await del("/api/reports/" + encodeURIComponent(report.id));
      await reloadReports();
      showToast("报告已删除");
      location.hash = "#knowledge";
    } catch (err) {
      showToast("删除失败：" + err.message);
    }
  };

  const handleAssetSubmit = async (e) => {
    e.preventDefault();
    if (!report || !assetForm.code.trim()) return;
    setSavingAsset(true);
    try {
      await post("/api/reports/" + encodeURIComponent(report.id) + "/assets", {
        code: assetForm.code,
        name: assetForm.name,
        market: assetForm.market
      });
      setAssetForm({ code: "", name: "", market: "A股" });
      await loadAssetLinks(report.id);
      showToast("关联标的已保存");
    } catch (err) {
      showToast("保存关联失败：" + err.message);
    } finally {
      setSavingAsset(false);
    }
  };

  const handleAssetDelete = async (link) => {
    if (!confirmDanger("确认移除与「" + (link.assetName || link.assetCode) + "」的关联？")) return;
    try {
      await del("/api/report-asset-links/" + encodeURIComponent(link.id));
      await loadAssetLinks(report.id);
      showToast("关联已移除");
    } catch (err) {
      showToast("移除关联失败：" + err.message);
    }
  };

  if (error) return (
    <div class="nav-page">
      <div class="reader-toolbar"><a href="#today" class="back-link">← 返回</a></div>
      <div class="empty-state"><p>报告加载失败：{error}</p></div>
    </div>
  );
  if (!report) return <div class="nav-page"><p>加载中...</p></div>;

  const reportUrl = "/reports/" + report.file.split("/").map(encodeURIComponent).join("/");

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
      <ReportAssetPanel
        links={assetLinks}
        form={assetForm}
        saving={savingAsset}
        onChange={setAssetForm}
        onSubmit={handleAssetSubmit}
        onDelete={handleAssetDelete}
      />
      <iframe src={reportUrl} title="报告预览" id="reportFrame" />
    </section>
  );
}

function ReportAssetPanel({ links, form, saving, onChange, onSubmit, onDelete }) {
  return (
    <section class="report-assets-panel">
      <div class="related-head"><span>相关标的</span></div>
      <div class="report-asset-list">
        {links.length ? links.map(link => (
          <span class={"report-asset-chip " + link.source} key={link.id}>
            <a href="#portfolio">{link.assetName || link.assetCode}</a>
            <em>{link.assetCode}{link.assetMarket ? " · " + link.assetMarket : ""}</em>
            <button type="button" onClick={() => onDelete(link)} title="移除关联">×</button>
          </span>
        )) : <p class="related-empty">暂无关联标的</p>}
      </div>
      <form class="report-asset-form" onSubmit={onSubmit}>
        <input required placeholder="代码" value={form.code} onInput={e => onChange({ ...form, code: e.target.value })} />
        <input placeholder="名称" value={form.name} onInput={e => onChange({ ...form, name: e.target.value })} />
        <input placeholder="市场" value={form.market} onInput={e => onChange({ ...form, market: e.target.value })} />
        <button type="submit" disabled={saving || !form.code.trim()}>{saving ? "保存中" : "添加关联"}</button>
      </form>
    </section>
  );
}
