import { useState } from "preact/hooks";
import { tasks, logs, status, refresh, showToast } from "../store.js";
import { post } from "../api.js";

export function Tasks() {
  const [form, setForm] = useState({ name: "", goal: "", implementation: "", schedule: "" });
  const [busy, setBusy] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState("");
  const [savingScheduleId, setSavingScheduleId] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleEdits, setScheduleEdits] = useState({});
  const [tab, setTab] = useState("tasks");

  const settings = status.value?.settings || {};
  const automationEnabled = settings.automationEnabled;

  const toggleGlobal = async () => {
    await post("/api/automation/toggle", { enabled: !automationEnabled });
    await refresh();
    showToast(automationEnabled ? "自动日更已暂停" : "自动日更已开启");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await post("/api/automation/tasks", form); setForm({ name: "", goal: "", implementation: "", schedule: "" }); await refresh(); showToast("任务已创建"); }
    finally { setBusy(false); }
  };

  const handleToggle = async (id) => {
    await post(`/api/automation/tasks/${encodeURIComponent(id)}/toggle`);
    await refresh(); showToast("状态已更新");
  };

  const handleRunDailyTask = async (task) => {
    setRunningTaskId(task.id);
    try {
      const result = await post("/api/jobs/daily", {});
      await refresh();
      showToast(result.skipped ? result.reason : `日更完成，生成 ${result.reports.length} 篇报告`);
    } finally {
      setRunningTaskId("");
    }
  };

  const handleTaskScheduleSave = async (e, task) => {
    e.preventDefault();
    const time = scheduleEdits[task.id] ?? task.scheduleTime;
    setSavingScheduleId(task.id);
    try {
      await post(`/api/automation/tasks/${encodeURIComponent(task.id)}/schedule`, { time });
      await refresh();
      showToast(`${task.name} 执行时间已更新为 ${time}`);
      setEditingScheduleId("");
    } finally {
      setSavingScheduleId("");
    }
  };

  const scheduleValue = (task) => scheduleEdits[task.id] ?? task.scheduleTime ?? "";

  const openScheduleEditor = (task) => {
    setScheduleEdits({ ...scheduleEdits, [task.id]: scheduleValue(task) });
    setEditingScheduleId(task.id);
  };

  const closeScheduleEditor = (task) => {
    const nextEdits = { ...scheduleEdits };
    delete nextEdits[task.id];
    setScheduleEdits(nextEdits);
    setEditingScheduleId("");
  };

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>任务</h1>
        <p class="page-description">管理自动化任务和查看执行日志。</p>
      </div>

      <section class="board route-panel">
        <div class="board-head">
          <div><h2>自动化调度</h2><p>{automationEnabled ? "运行中 · 按任务配置自动执行" : "已暂停 · 任务时间配置已保留"}</p></div>
          <div class="schedule-actions">
            <button class={`ghost-button ${automationEnabled ? "danger" : "primary-action"}`} onClick={toggleGlobal}>
              {automationEnabled ? "暂停自动化" : "开启自动化"}
            </button>
          </div>
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
              <input type="time" value={form.schedule} onInput={e => setForm({ ...form, schedule: e.target.value })} aria-label="任务执行时间" />
              <button type="submit" disabled={busy}>新增</button>
            </form>
          </div>
          <div class="route-card-grid">
            {tasks.value.map(t => (
              <article key={t.id} class="route-card">
                <h2>{t.name}</h2>
                <span class="mini-label">{t.enabled ? "运行中" : "暂停"} · {t.schedule}</span>
                <p><b>目标：</b>{t.goal}</p>
                {editingScheduleId === t.id && (
                  <form class="task-schedule-form" onSubmit={(e) => handleTaskScheduleSave(e, t)}>
                    <label>执行时间</label>
                    <input type="time" value={scheduleValue(t)} onInput={e => setScheduleEdits({ ...scheduleEdits, [t.id]: e.target.value })} aria-label={`${t.name} 执行时间`} />
                    <div class="task-schedule-buttons">
                      <button class="ghost-button primary-action" type="submit" disabled={!scheduleValue(t) || savingScheduleId === t.id}>
                        {savingScheduleId === t.id ? "保存中..." : "保存"}
                      </button>
                      <button class="ghost-button" type="button" onClick={() => closeScheduleEditor(t)}>取消</button>
                    </div>
                  </form>
                )}
                <div class="route-card-actions">
                  <button class="ghost-button" onClick={() => handleToggle(t.id)}>{t.enabled ? "暂停" : "开启"}</button>
                  {isDailyTask(t) && (
                    <button class="ghost-button primary-action" onClick={() => handleRunDailyTask(t)} disabled={!!runningTaskId}>
                      {runningTaskId === t.id ? "执行中..." : "立即执行"}
                    </button>
                  )}
                  {editingScheduleId !== t.id && (
                    <button class="ghost-button" onClick={() => openScheduleEditor(t)}>修改时间</button>
                  )}
                </div>
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

function isDailyTask(task) {
  return task.id === "daily-research" || /每日市场简报|日更/.test(`${task.name || ""} ${task.implementation || ""}`);
}
