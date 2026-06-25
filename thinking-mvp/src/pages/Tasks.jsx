import { useState } from "preact/hooks";
import { tasks, logs, status, refresh, showToast } from "../store.js";
import { post } from "../api.js";

export function Tasks() {
  const [form, setForm] = useState({ name: "", goal: "", implementation: "", schedule: "" });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("tasks");

  const automationEnabled = status.value?.settings?.automationEnabled;

  const toggleGlobal = async () => {
    await post("/api/automation/toggle", { enabled: !automationEnabled });
    await refresh();
    showToast(automationEnabled ? "自动日更已暂停" : "自动日更已开启");
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post("/api/automation/tasks", form); setForm({ name: "", goal: "", implementation: "", schedule: "" }); await refresh(); showToast("任务已创建"); }
    finally { setBusy(false); }
  };

  const handleToggle = async (id) => {
    await post(`/api/automation/tasks/${encodeURIComponent(id)}/toggle`);
    await refresh(); showToast("状态已更新");
  };

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>任务</h1>
        <p class="page-description">管理自动化任务和查看执行日志。</p>
      </div>

      <section class="board route-panel">
        <div class="board-head">
          <div><h2>自动化调度</h2><p>{automationEnabled ? "运行中 · 08:30 自动执行" : "已暂停"}</p></div>
          <button class={`ghost-button ${automationEnabled ? "danger" : "primary-action"}`} onClick={toggleGlobal}>
            {automationEnabled ? "暂停自动化" : "开启自动化"}
          </button>
        </div>
      </section>

      <div class="board-filters" style="margin-bottom:12px">
        <button class={`filter-btn ${tab === "tasks" ? "active" : ""}`} onClick={() => setTab("tasks")}>任务</button>
        <button class={`filter-btn ${tab === "logs" ? "active" : ""}`} onClick={() => setTab("logs")}>日志</button>
      </div>

      {tab === "tasks" && (
        <section class="board route-panel">
          <div class="board-head"><div><h2>任务列表</h2><p>{tasks.value.filter(t => t.enabled).length} 运行中 / {tasks.value.length} 总计</p></div></div>
          <div class="route-form-wrap">
            <form class="business-form" onSubmit={handleSubmit}>
              <input required placeholder="任务名称" value={form.name} onInput={e => setForm({ ...form, name: e.target.value })} />
              <input required placeholder="目标" value={form.goal} onInput={e => setForm({ ...form, goal: e.target.value })} />
              <input required placeholder="执行实现" value={form.implementation} onInput={e => setForm({ ...form, implementation: e.target.value })} />
              <button type="submit" disabled={busy}>新增</button>
            </form>
          </div>
          <div class="route-card-grid">
            {tasks.value.map(t => (
              <article key={t.id} class="route-card">
                <h2>{t.name}</h2>
                <span class="mini-label">{t.enabled ? "运行中" : "暂停"} · {t.schedule}</span>
                <p><b>目标：</b>{t.goal}</p>
                <button class="ghost-button" onClick={() => handleToggle(t.id)}>{t.enabled ? "暂停" : "开启"}</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "logs" && (
        <section class="board route-panel">
          <div class="board-head"><div><h2>执行日志</h2><p>最近 200 条</p></div></div>
          <div class="log-list">
            {logs.value.slice(0, 50).map(l => (
              <div key={l.id} class="log-item">
                <span class="log-time">{l.local_time || l.created_at}</span>
                <span class="log-type">{l.type}</span>
                <span class="log-msg">{l.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
