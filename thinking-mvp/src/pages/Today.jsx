import { useState } from "preact/hooks";
import { status, reports, marketSnapshot, refresh, showToast } from "../store.js";
import { post } from "../api.js";
import { ReportList } from "../components/ReportList.jsx";

export function Today() {
  const s = status.value;
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("industry");
  const [busy, setBusy] = useState(false);

  const handleResearch = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setBusy(true);
    try {
      const { report } = await post("/api/research", { topic, type });
      setTopic("");
      await refresh();
      showToast(`已生成：${report.title}`);
      location.hash = `#report/${encodeURIComponent(report.id)}`;
    } finally { setBusy(false); }
  };

  const handleDaily = async () => {
    setBusy(true);
    try {
      const result = await post("/api/jobs/daily", {});
      await refresh();
      showToast(result.skipped ? result.reason : `日更完成，生成 ${result.reports.length} 篇报告`);
    } finally { setBusy(false); }
  };

  const snap = marketSnapshot.value;
  const today = s?.now?.split("·")[1]?.trim()?.split(" ")[0] || "";
  const todayReports = reports.value.filter(r => r.localDate === today);

  return (
    <div class="nav-page">
      <div class="page-head">
        <p class="time-row">{s?.now || "--"}</p>
        <h1>今日</h1>
      </div>

      {/* 行情快照 */}
      {snap.indices.length > 0 && (
        <section class="market-strip">
          {snap.indices.map(i => (
            <div key={i.code} class="market-strip-item">
              <span class="market-name">{i.name}</span>
              <span class="market-level">{i.level || "--"}</span>
              <span class={`market-change ${Number(i.changePct) >= 0 ? "up" : "down"}`}>
                {i.changePct ? `${i.changePct}%` : "--"}
              </span>
            </div>
          ))}
          {snap.updatedAt && <span class="market-time">更新：{new Date(snap.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>}
        </section>
      )}

      <section class="stats-grid">
        <article class="stat-card"><span>今日更新</span><strong>{s?.todayUpdates ?? 0}</strong><p>网页报告</p></article>
        <article class="stat-card"><span>未读合计</span><strong>{s?.unreadCount ?? 0}</strong><p>近 7 天</p></article>
      </section>

      <section class="composer">
        <div>
          <h2>发起调研</h2>
          <p>输入主题，系统会生成网页报告并写入本地资料库。</p>
        </div>
        <form class="research-form" onSubmit={handleResearch}>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="industry">产业链深度</option>
            <option value="market">市场快览</option>
            <option value="stock">个股跟踪</option>
            <option value="policy">政策扫描</option>
            <option value="custom">主题调研</option>
          </select>
          <input value={topic} onInput={e => setTopic(e.target.value)} required placeholder="例如：机器人产业链：减速器与端侧智能" />
          <button type="submit" disabled={busy}>生成报告</button>
        </form>
      </section>

      <section class="board">
        <div class="board-head">
          <div><h2>今日报告</h2></div>
          <button class="ghost-button" onClick={handleDaily} disabled={busy}>执行日更</button>
        </div>
        <div class="report-sections">
          <ReportList reports={todayReports} emptyText="今日暂无报告" />
          {reports.value.length > todayReports.length && (
            <>
              <div class="section-label old">历史</div>
              <ReportList reports={reports.value.filter(r => r.localDate !== today).slice(0, 20)} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
