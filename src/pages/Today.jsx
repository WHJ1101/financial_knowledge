import { useState } from "preact/hooks";
import { status, reports, pressure, loadTodayData, showToast } from "../store.js";
import { post } from "../api.js";
import { ReportList } from "../components/ReportList.jsx";
import { PressureCard } from "../components/PressureCard.jsx";

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
      await loadTodayData();
      showToast(`已生成：${report.title}`);
      location.hash = `#report/${encodeURIComponent(report.id)}`;
    } catch (err) {
      showToast(`生成失败：${err.message}`);
    } finally { setBusy(false); }
  };

  const handleDaily = async () => {
    setBusy(true);
    try {
      const result = await post("/api/jobs/daily", {});
      await loadTodayData();
      showToast(result.skipped ? result.reason : `日更完成，生成 ${result.reports.length} 篇报告`);
    } catch (err) {
      showToast(`日更失败：${err.message}`);
    } finally { setBusy(false); }
  };

  const handlePressureSync = async () => {
    setBusy(true);
    try {
      await post("/api/pressure/sync", {});
      await loadTodayData();
      showToast("板块压力已刷新");
    } catch (err) {
      showToast(`压力刷新失败：${err.message}`);
    } finally { setBusy(false); }
  };

  const today = s?.today || "";
  const activeReports = reports.value.filter(r => !r.archived);
  const todayReports = activeReports.filter(r => r.localDate === today);
  const historyReports = activeReports.filter(r => r.localDate !== today).slice(0, 20);
  const pressureThemes = pressure.value || [];

  return (
    <div class="nav-page">
      <div class="page-head">
        <p class="time-row">{s?.nowDisplay || s?.now || "--"}</p>
        <h1>今日</h1>
      </div>

      <section class="stats-grid">
        <a href="#knowledge" class="stat-card"><span>今日更新</span><strong>{s?.todayUpdates ?? 0}</strong><p>网页报告</p></a>
        <a href="#knowledge" class="stat-card"><span>未读合计</span><strong>{s?.unreadCount ?? 0}</strong><p>近 7 天</p></a>
      </section>

      {pressureThemes.length > 0 && (
        <section class="board pressure-board">
          <div class="board-head">
            <div>
              <h2>板块压力监控</h2>
              <p>放量抛售 + 板块下杀 + 恐慌上升 + 资金逃离高 beta 的四维合成分</p>
            </div>
            <button class="ghost-button" onClick={handlePressureSync} disabled={busy}>刷新压力</button>
          </div>
          <div class="pressure-grid">
            {pressureThemes.map((theme) => <PressureCard key={theme.id} theme={theme} />)}
          </div>
        </section>
      )}

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
          {historyReports.length > 0 && (
            <>
              <div class="section-label old">历史</div>
              <ReportList reports={historyReports} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
