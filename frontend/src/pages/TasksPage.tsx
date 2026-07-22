/** 任务自动化页（超管）：全局开关 + 内置任务 + 执行日志。 */
import { useState } from "react";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { useRunDaily, useStatus } from "@/hooks/useStatus";
import {
  useLogs,
  useTasks,
  useToggleAutomation,
  useToggleTask,
  useUpdateTaskSchedule,
  type AutomationTask,
} from "@/hooks/useTasks";

type Tab = "tasks" | "logs";
type Note = { text: string; error: boolean };

export function TasksPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [note, setNote] = useState<Note | null>(null);
  const status = useStatus();
  const tasks = useTasks();
  const toggleGlobal = useToggleAutomation();
  const automationEnabled = status.data?.settings.automationEnabled ?? false;
  const automationStatus = status.isLoading
    ? "状态加载中"
    : status.isError
      ? "状态不可用"
      : automationEnabled
        ? "运行中 · 按任务配置的时间自动执行"
        : "已暂停 · 任务定时配置已保留";

  const onToggleGlobal = () => {
    toggleGlobal.mutate(!automationEnabled, {
      onSuccess: () => setNote({ text: automationEnabled ? "自动化已暂停" : "自动化已开启", error: false }),
      onError: (e) => setNote({ text: e instanceof ApiError ? e.detail : "操作失败", error: true }),
    });
  };

  return (
    <div className="page fade-up">
      <header className="page-head">
        <h1>任务</h1>
        <p className="muted">自动化调度与执行日志（系统级，仅超管可见）</p>
      </header>

      {note && <div className={note.error ? "inline-note login-error" : "inline-note"} role={note.error ? "alert" : "status"}>{note.text}</div>}

      <section className="board">
        <div className="board-head">
          <div>
            <h2>自动化调度</h2>
            <p className="muted">{automationStatus}</p>
          </div>
          <GlassButton
            tone={automationEnabled ? "danger" : "primary"}
            refraction={!automationEnabled}
            onClick={onToggleGlobal}
            disabled={!status.isSuccess || toggleGlobal.isPending}
          >
            {toggleGlobal.isPending
              ? "保存中…"
              : status.isLoading
                ? "状态加载中…"
                : status.isError
                  ? "无法操作"
                  : automationEnabled
                    ? "暂停自动化"
                    : "开启自动化"}
          </GlassButton>
        </div>
        {status.isError && (
          <div className="error-state" role="alert">
            自动化状态加载失败 <GlassButton tone="text" size="sm" onClick={() => status.refetch()}>重试</GlassButton>
          </div>
        )}
      </section>

      <div className="tab-bar inline" role="tablist" aria-label="任务内容">
        <button role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "tab active" : "tab"} onClick={() => setTab("tasks")}>
          任务
        </button>
        <button role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "tab active" : "tab"} onClick={() => setTab("logs")}>
          日志
        </button>
      </div>

      {tab === "tasks" && tasks.isLoading && <p className="muted pad">加载任务…</p>}
      {tab === "tasks" && tasks.isError && (
        <div className="panel error-state" role="alert">
          任务加载失败 <GlassButton tone="text" size="sm" onClick={() => tasks.refetch()}>重试</GlassButton>
        </div>
      )}
      {tab === "tasks" && tasks.isSuccess && <TaskList tasks={tasks.data} setNote={setNote} />}
      {tab === "logs" && <LogList />}
    </div>
  );
}

function TaskList({ tasks, setNote }: { tasks: AutomationTask[]; setNote: (note: Note) => void }) {
  const toggle = useToggleTask();
  const daily = useRunDaily();
  const updateSchedule = useUpdateTaskSchedule();
  const [editing, setEditing] = useState<string | null>(null);
  const [time, setTime] = useState("");

  if (!tasks.length) {
    return <div className="panel empty-state">暂无自动化任务。当前仅支持每日市场简报。</div>;
  }

  const onSaveSchedule = (task: AutomationTask) => {
    updateSchedule.mutate(
      { id: task.id, time: time || task.scheduleTime },
      {
        onSuccess: () => {
          setNote({ text: `${task.name} 执行时间已更新`, error: false });
          setEditing(null);
        },
        onError: (e) => setNote({ text: e instanceof ApiError ? e.detail : "保存失败", error: true }),
      },
    );
  };

  return (
    <div className="task-grid">
      {tasks.map((t) => (
        <GlassPanel as="article" tone="data" interactive key={t.id} className="task-card">
          <div className="task-card-head">
            <h3>{t.name}</h3>
            <span className={t.executable && t.enabled ? "badge badge-on" : "badge badge-neutral"}>
              {t.executable ? (t.enabled ? "配置已启用" : "配置已暂停") : "规划中"}
            </span>
          </div>
          <p className="muted task-goal">{t.goal}</p>
          <div className="task-schedule muted">定时 · {t.schedule}</div>

          {!t.executable ? (
            <p className="field-hint">当前版本尚未配置该任务的执行器</p>
          ) : editing === t.id ? (
            <div className="task-schedule-edit">
              <input aria-label={`${t.name} 执行时间`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              <GlassButton tone="secondary" size="sm" onClick={() => onSaveSchedule(t)} disabled={updateSchedule.isPending}>
                {updateSchedule.isPending ? "保存中…" : "保存"}
              </GlassButton>
              <GlassButton tone="utility" size="sm" onClick={() => setEditing(null)}>
                取消
              </GlassButton>
            </div>
          ) : (
            <div className="task-actions">
              <GlassButton
                tone="utility"
                size="sm"
                onClick={() =>
                  toggle.mutate(t.id, {
                    onSuccess: () => setNote({ text: `${t.name}${t.enabled ? "已暂停" : "已开启"}`, error: false }),
                    onError: (e) => setNote({ text: e instanceof ApiError ? e.detail : "操作失败", error: true }),
                  })
                }
                disabled={toggle.isPending}
              >
                {toggle.isPending && toggle.variables === t.id ? "保存中…" : t.enabled ? "暂停" : "开启"}
              </GlassButton>
              {t.executable && (
                <GlassButton
                  tone="secondary"
                  size="sm"
                  onClick={() =>
                    daily.mutate(undefined, {
                      onSuccess: () => setNote({ text: `${t.name}执行完成`, error: false }),
                      onError: (e) => setNote({ text: e instanceof ApiError ? e.detail : "执行失败", error: true }),
                    })
                  }
                  disabled={daily.isPending}
                >
                  {daily.isPending ? "执行中…" : "立即执行"}
                </GlassButton>
              )}
              <GlassButton
                tone="utility"
                size="sm"
                onClick={() => {
                  setEditing(t.id);
                  setTime(t.scheduleTime);
                }}
              >
                改时间
              </GlassButton>
            </div>
          )}
        </GlassPanel>
      ))}
    </div>
  );
}

function LogList() {
  const logs = useLogs();
  const [page, setPage] = useState(1);
  if (logs.isLoading) return <p className="muted pad">加载中…</p>;
  if (logs.isError) return <div className="panel error-state" role="alert">日志加载失败 <GlassButton tone="text" size="sm" onClick={() => logs.refetch()}>重试</GlassButton></div>;
  if (!logs.data?.length) return <div className="panel empty-state">暂无日志</div>;
  const pageSize = 30;
  const pageCount = Math.ceil(logs.data.length / pageSize);
  const visible = logs.data.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <GlassPanel tone="data" className="log-list">
        {visible.map((l) => (
          <div key={l.id} className="log-item">
            <span className="log-time muted">{l.localTime}</span>
            <span className="log-type">{l.type}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </GlassPanel>
      <nav className="pagination" aria-label="日志分页">
        <GlassButton tone="utility" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</GlassButton>
        <span>{page} / {pageCount}</span>
        <GlassButton tone="utility" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</GlassButton>
      </nav>
    </>
  );
}
