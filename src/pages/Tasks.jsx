import { useState } from "preact/hooks";
import { tasks, logs, status, loadTasksData, showToast } from "../store.js";
import { post } from "../api.js";

export function Tasks() {
  const [runningTaskId, setRunningTaskId] = useState("");
  const [savingScheduleId, setSavingScheduleId] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleEdits, setScheduleEdits] = useState({});
  const [tab, setTab] = useState("tasks");

  const settings = status.value?.settings || {};
  const automationEnabled = settings.automationEnabled;
  const executableTasks = tasks.value.filter(t => t.executable);
  const plannedTasks = tasks.value.filter(t => !t.executable);

  const toggleGlobal = async () => {
    try {
      await post("/api/automation/toggle", { enabled: !automationEnabled });
      await loadTasksData();
      showToast(automationEnabled ? "自动日更已暂停" : "自动日更已开启");
    } catch (err) { showToast(`操作失败：${err.message}`); }
  };

  const handleToggle = async (id) => {
    try {
      await post(`/api/automation/tasks/${encodeURIComponent(id)}/toggle`);
      await loadTasksData(); showToast("状态已更新");
    } catch (err) { showToast(`操作失败：${err.message}`); }
  };

  const handleRunDailyTask = async (task) => {
    setRunningTaskId(task.id);
    try {
      const result = await post("/api/jobs/daily", {});
      await loadTasksData();
      showToast(result.skipped ? result.reason : `日更完成，生成 ${result.reports.length} 篇报告`);
    } catch (err) {
      showToast(`执行失败：${err.message}`);
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
      await loadTasksData();
      showToast(`${task.name} 执行时间已更新为 ${time}`);
      setEditingScheduleId("");
    } catch (err) {
      showToast(`保存失败：${err.message}`);
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
          <div class="board-head"><div><h2>内置投研自动化</h2><p>{executableTasks.filter(t => t.enabled).length} 运行中 / {executableTasks.length} 可执行</p></div></div>
          <div class="route-card-grid">
            {executableTasks.map(t => (
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
                  {t.executable && (
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
          {!executableTasks.length && <div class="empty-state"><p>暂无可执行自动化。当前版本仅支持每日市场简报任务。</p></div>}
          {plannedTasks.length > 0 && (
            <div class="planned-task-list">
              <div class="section-label old">规划中任务</div>
              {plannedTasks.map(t => (
                <article key={t.id} class="route-card unavailable-task">
                  <h2>{t.name}</h2>
                  <span class="mini-label">规划中 · 暂不可执行</span>
                  <p><b>目标：</b>{t.goal}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "logs" && (
        <section class="board route-panel">
          <div class="board-head"><div><h2>执行日志</h2><p>最近 50 条</p></div></div>
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

