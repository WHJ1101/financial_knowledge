/** 任务自动化页（超管）：全局开关 + 内置任务 + 执行日志。 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import { useRunDaily, useStatus } from "@/hooks/useStatus";
import {
  useLogs,
  useAutomationRuns,
  useRefreshResearchCapability,
  useResearchCapabilities,
  useResearchDataHealth,
  useTasks,
  useToggleAutomation,
  useToggleTask,
  useUpdateTaskSchedule,
  type AutomationTask,
  type AutomationRun,
  type AutomationRunStatus,
} from "@/hooks/useTasks";

type Tab = "runs" | "tasks" | "data" | "logs";
type Note = { text: string; error: boolean };

export function TasksPage() {
  const capabilities = useInputCapabilities();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.has("run") ? "runs" : "tasks");
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

      <PullToRefresh
        disabled={!capabilities.isMobile}
        onRefresh={() => Promise.all([status.refetch(), tasks.refetch()])}
      >
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
        <button role="tab" aria-selected={tab === "runs"} className={tab === "runs" ? "tab active" : "tab"} onClick={() => setTab("runs")}>
          运行
        </button>
        <button role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "tab active" : "tab"} onClick={() => setTab("tasks")}>
          任务
        </button>
        <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "tab active" : "tab"} onClick={() => setTab("data")}>
          数据底座
        </button>
        <button role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "tab active" : "tab"} onClick={() => setTab("logs")}>
          日志
        </button>
      </div>

      {tab === "runs" && <RunList focusRunId={searchParams.get("run")} />}
      {tab === "tasks" && tasks.isLoading && <p className="muted pad">加载任务…</p>}
      {tab === "tasks" && tasks.isError && (
        <div className="panel error-state" role="alert">
          任务加载失败 <GlassButton tone="text" size="sm" onClick={() => tasks.refetch()}>重试</GlassButton>
        </div>
      )}
      {tab === "tasks" && tasks.isSuccess && <TaskList tasks={tasks.data} setNote={setNote} />}
      {tab === "data" && <ResearchDataPanel setNote={setNote} />}
      {tab === "logs" && <LogList />}
      </PullToRefresh>
    </div>
  );
}

function ResearchDataPanel({ setNote }: { setNote: (note: Note) => void }) {
  const health = useResearchDataHealth();
  const capabilities = useResearchCapabilities();
  const refresh = useRefreshResearchCapability();
  if (health.isLoading || capabilities.isLoading) return <p className="muted pad">加载数据底座状态…</p>;
  if (health.isError || capabilities.isError || !health.data || !capabilities.data) {
    return (
      <div className="panel error-state" role="alert">
        数据底座状态加载失败{" "}
        <GlassButton
          tone="text"
          size="sm"
          onClick={() => {
            health.refetch();
            capabilities.refetch();
          }}
        >
          重试
        </GlassButton>
      </div>
    );
  }
  const macroCapabilities = capabilities.data.filter((item) => item.key.startsWith("macro."));
  return (
    <div className="task-grid">
      <GlassPanel as="section" tone="data" className="task-card research-health-card">
        <div className="task-card-head">
          <div>
            <h3>Research Data Hub</h3>
            <p className="muted">
              Manifest {health.data.manifest_version} · AKShare {health.data.akshare_version}
            </p>
          </div>
          <span className="badge badge-on">
            {health.data.available_capability_count}/{health.data.capability_count} 已实际覆盖
          </span>
        </div>
        <p className="muted">
          原始响应保留来源运行、结构版本、内容哈希与抓取时间；投研消费统一遵守决策时点约束。
        </p>
        <p className="muted research-coverage-copy">
          全局基线 {health.data.baseline_available_count}/{health.data.baseline_capability_count} ·
          按标的能力 {health.data.contextual_available_count}/{health.data.contextual_capability_count}。
          按标的能力在辩论、持仓分析或目标刷新时带入代码、日期与报告期，并按需生成快照。
        </p>
        {health.data.orphaned_snapshot_capability_count > 0 && (
          <p className="muted research-coverage-copy">
            历史清单快照 {health.data.orphaned_snapshot_capability_count} 项，数据继续保留供迁移审计，
            不计入当前 Manifest 覆盖率。
          </p>
        )}
        {health.data.recent_failures.length > 0 && (
          <div className="run-steps" aria-label="近期数据失败">
            {health.data.recent_failures.slice(0, 5).map((item) => (
              <div className="run-step" key={item.id}>
                <span>{item.capability_key ?? "未知能力"}</span>
                <span className="login-error">{item.error_code ?? "failed"}</span>
                {item.error_message && <small className="muted">{item.error_message}</small>}
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
      {macroCapabilities.map((capability) => {
        const snapshot = health.data.latest[capability.key];
        return (
          <GlassPanel as="article" tone="data" className="task-card" key={capability.key}>
            <div className="task-card-head">
              <div>
                <h3>{capability.key}</h3>
                <p className="muted">{capability.upstream_family} · {capability.function}</p>
              </div>
              <span className={snapshot ? "badge badge-on" : "badge badge-neutral"}>
                {snapshot ? "已有快照" : "待刷新"}
              </span>
            </div>
            <p className="muted">
              {snapshot
                ? `最近抓取 ${new Date(snapshot.retrieved_at).toLocaleString("zh-CN")} · ${snapshot.snapshot_count} 个版本`
                : "当前尚无可供投研消费的快照"}
            </p>
            <GlassButton
              tone="secondary"
              size="sm"
              disabled={refresh.isPending}
              onClick={() =>
                refresh.mutate(capability.key, {
                  onSuccess: (response) =>
                    setNote({ text: `数据刷新已入队：${response.run_id}`, error: false }),
                  onError: (error) =>
                    setNote({
                      text: error instanceof ApiError ? error.detail : "数据刷新入队失败",
                      error: true,
                    }),
                })
              }
            >
              {refresh.isPending && refresh.variables === capability.key ? "正在入队…" : "立即刷新"}
            </GlassButton>
          </GlassPanel>
        );
      })}
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
                    onSuccess: () => setNote({ text: `${t.name}已入队，可在“运行”页查看进度`, error: false }),
                      onError: (e) => setNote({ text: e instanceof ApiError ? e.detail : "执行失败", error: true }),
                    })
                  }
                  disabled={daily.isPending}
                >
                  {daily.isPending ? "正在入队…" : "立即执行"}
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

const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  canceled: "已取消",
};

const STEP_LABEL: Record<string, string> = {
  daily_guard: "当日去重",
  market: "市场数据与简报",
  research_data: "Research Data Hub",
  feishu: "飞书信号",
  pressure: "板块压力",
  report: "报告生成",
  portfolio_history: "组合历史",
  notification: "通知",
};

function RunList({ focusRunId }: { focusRunId: string | null }) {
  const runs = useAutomationRuns();
  useEffect(() => {
    if (!focusRunId || !runs.data) return;
    const element = document.getElementById(`run-${focusRunId}`);
    if (element?.scrollIntoView) element.scrollIntoView({ block: "nearest" });
  }, [focusRunId, runs.data]);
  if (runs.isLoading) return <p className="muted pad">加载运行记录…</p>;
  if (runs.isError) {
    return <div className="panel error-state" role="alert">运行记录加载失败 <GlassButton tone="text" size="sm" onClick={() => runs.refetch()}>重试</GlassButton></div>;
  }
  if (!runs.data?.length) return <div className="panel empty-state">暂无运行记录</div>;
  return (
    <div className="task-grid">
      {runs.data.map((run) => <RunCard key={run.id} run={run} focused={run.id === focusRunId} />)}
    </div>
  );
}

function RunCard({ run, focused }: { run: AutomationRun; focused: boolean }) {
  const active = run.status === "queued" || run.status === "running";
  return (
    <GlassPanel
      as="article"
      tone="data"
      id={`run-${run.id}`}
      className={focused ? "task-card run-card run-card-focused" : "task-card run-card"}
    >
      <div className="task-card-head">
        <div>
          <h3>{run.kind === "daily_briefing" ? "每日市场简报" : run.kind}</h3>
          <p className="muted">{new Date(run.created_at).toLocaleString("zh-CN")}</p>
        </div>
        <span className={active ? "badge badge-on" : run.status === "failed" ? "badge badge-danger" : "badge badge-neutral"}>
          {RUN_STATUS_LABEL[run.status]}
        </span>
      </div>
      <div className="run-steps" aria-label="运行步骤">
        {run.steps.length ? run.steps.map((step) => (
          <div className="run-step" key={step.key}>
            <span>{STEP_LABEL[step.key] ?? step.key}</span>
            <span className="muted">{step.status === "succeeded" ? "完成" : step.status === "skipped" ? "跳过" : step.status === "failed" ? "失败" : "执行中"}{step.count != null ? ` · ${step.count}` : ""}</span>
            {step.error_message && <small className="login-error">{step.error_message}</small>}
          </div>
        )) : <p className="muted">等待 Worker 接单</p>}
      </div>
      {run.error_message && <p className="login-error" role="alert">{run.error_message}</p>}
    </GlassPanel>
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
