/** 今日页：状态概览 + 板块压力 + 发起调研 + 日更。 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useSession } from "@/hooks/useAuth";
import { usePressure, useSyncPressure } from "@/hooks/useMarket";
import { useCreateResearch, useRunDaily, useStatus } from "@/hooks/useStatus";
import { PressureCard } from "@/components/PressureCard";
import {
  GlassButton,
  GlassActionLink,
  GlassSkeleton,
  GlassSurface,
  StatusIndicator,
  type GlassFeedbackState,
} from "@/components/LiquidGlass";
import { useReports } from "@/hooks/useReports";

const RESEARCH_TYPES = [
  { value: "industry", label: "产业链深度" },
  { value: "market", label: "市场快览" },
  { value: "stock", label: "个股跟踪" },
  { value: "policy", label: "政策扫描" },
  { value: "custom", label: "主题调研" },
];

export function TodayPage() {
  const status = useStatus();
  const reports = useReports();
  const navigate = useNavigate();
  const pressure = usePressure();
  const syncPressure = useSyncPressure();
  const session = useSession();
  const research = useCreateResearch();
  const daily = useRunDaily();
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("industry");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [researchSuccess, setResearchSuccess] = useState(false);
  const [pressureSuccess, setPressureSuccess] = useState(false);
  const [dailySuccess, setDailySuccess] = useState(false);
  const navigationTimer = useRef<number | null>(null);
  const pressureFeedbackTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navigationTimer.current != null) window.clearTimeout(navigationTimer.current);
    if (pressureFeedbackTimer.current != null) window.clearTimeout(pressureFeedbackTimer.current);
  }, []);

  const isSuperadmin = session.data?.user?.role === "superadmin";
  const s = status.data;

  const onResearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    if (navigationTimer.current != null) window.clearTimeout(navigationTimer.current);
    setResearchSuccess(false);
    setNote(null);
    research.mutate(
      { topic, type },
      {
        onSuccess: (r) => {
          setTopic("");
          setResearchSuccess(true);
          setNote({ text: `已生成：${r.title}`, error: false });
          navigationTimer.current = window.setTimeout(() => {
            navigate(`/reports/${encodeURIComponent(r.id)}`);
          }, 420);
        },
        onError: (err) => setNote({
          text: err instanceof ApiError ? `生成失败：${err.detail}` : "生成失败",
          error: true,
        }),
      },
    );
  };

  const onDaily = () => {
    if (navigationTimer.current != null) window.clearTimeout(navigationTimer.current);
    setDailySuccess(false);
    setNote(null);
    daily.mutate(undefined, {
      onSuccess: (r) => {
        setDailySuccess(true);
        setNote({ text: `日更完成：${r.title}`, error: false });
        navigationTimer.current = window.setTimeout(() => {
          navigate(`/reports/${encodeURIComponent(r.id)}`);
        }, 420);
      },
      onError: (err) => setNote({
        text: err instanceof ApiError ? `日更失败：${err.detail}` : "日更失败",
        error: true,
      }),
    });
  };

  const onPressureRefresh = () => {
    if (pressureFeedbackTimer.current != null) window.clearTimeout(pressureFeedbackTimer.current);
    setPressureSuccess(false);
    setNote(null);
    if (!isSuperadmin) {
      void pressure.refetch().then((result) => {
        if (result.error) {
          setNote({ text: "压力数据重新加载失败，请稍后重试", error: true });
          return;
        }
        setPressureSuccess(true);
        setNote({ text: "板块压力数据已重新加载", error: false });
        pressureFeedbackTimer.current = window.setTimeout(() => setPressureSuccess(false), 1400);
      });
      return;
    }
    syncPressure.mutate(undefined, {
      onSuccess: () => {
        setPressureSuccess(true);
        setNote({ text: "板块压力数据已同步", error: false });
        pressureFeedbackTimer.current = window.setTimeout(() => setPressureSuccess(false), 1400);
      },
      onError: (err) => setNote({
        text: err instanceof ApiError ? `压力同步失败：${err.detail}` : "压力同步失败",
        error: true,
      }),
    });
  };

  const researchButtonState: GlassFeedbackState = research.isPending
    ? "loading"
    : researchSuccess
      ? "success"
      : research.isError
        ? "error"
        : "idle";
  const pressureButtonState: GlassFeedbackState = pressure.isFetching || syncPressure.isPending
    ? "loading"
    : pressureSuccess
      ? "success"
      : syncPressure.isError || pressure.isError
        ? "error"
        : "idle";
  const dailyButtonState: GlassFeedbackState = daily.isPending
    ? "loading"
    : dailySuccess
      ? "success"
      : daily.isError
        ? "error"
        : "idle";

  return (
    <div className="page today-page fade-up">
      <header className="page-head">
        <p className="eyebrow">{s?.nowDisplay ?? "暂无"}</p>
        <h1>今日</h1>
      </header>

      <section className="stat-row" aria-label="今日概览" aria-busy={status.isLoading || undefined}>
        <GlassSurface
          className="stat-cell"
          pointerHighlight
          to={s?.today ? `/knowledge?filter=today&date=${encodeURIComponent(s.today)}#reports` : "/knowledge?filter=today#reports"}
        >
          <span className="stat-mark" aria-hidden="true">更</span>
          <span className="stat-content">
            {status.isLoading
              ? <GlassSkeleton variant="stat" />
              : <span className="stat-num">{status.isSuccess ? (s?.todayUpdates ?? 0) : "暂无"}</span>}
            <span className="muted">今日更新</span>
          </span>
        </GlassSurface>
        <GlassSurface className="stat-cell" pointerHighlight to="/knowledge?filter=unread#reports">
          <span className="stat-mark" aria-hidden="true">读</span>
          <span className="stat-content">
            {status.isLoading
              ? <GlassSkeleton variant="stat" />
              : <span className="stat-num">{status.isSuccess ? (s?.unreadCount ?? 0) : "暂无"}</span>}
            <span className="muted">未读报告</span>
          </span>
        </GlassSurface>
        <GlassSurface className="stat-cell" pointerHighlight to="/knowledge#reports">
          <span className="stat-mark" aria-hidden="true">库</span>
          <span className="stat-content">
            {status.isLoading
              ? <GlassSkeleton variant="stat" />
              : <span className="stat-num">{status.isSuccess ? (s?.reportCount ?? 0) : "暂无"}</span>}
            <span className="muted">知识库总量</span>
          </span>
        </GlassSurface>
        <GlassSurface className="stat-cell stat-cell-status" pointerHighlight to="/settings#llm-profiles">
          <span className="stat-mark" aria-hidden="true">模</span>
          <span className="stat-content stat-content-status">
            {status.isLoading
              ? <GlassSkeleton variant="stat" />
              : (
                <StatusIndicator
                  tone={status.isError ? "warning" : s?.llm.configured ? "success" : "warning"}
                  label={status.isError ? "模型状态不可用" : s?.llm.configured ? "模型已配置" : "未配置模型"}
                />
              )}
          </span>
        </GlassSurface>
      </section>

      {status.isError && <div className="panel error-state" role="alert">状态概览加载失败 <GlassButton tone="text" size="sm" onClick={() => status.refetch()}>重试</GlassButton></div>}

      {note && <div className={note.error ? "inline-note login-error" : "inline-note success"} role={note.error ? "alert" : "status"}>{note.text}</div>}

      <section className="composer-card">
        <div className="composer-head">
          <h2>发起调研</h2>
          <p className="muted">输入主题，生成结构化研究报告并写入知识库</p>
        </div>
        <form className="composer-form" onSubmit={onResearch}>
          <select aria-label="调研类型" value={type} onChange={(e) => setType(e.target.value)}>
            {RESEARCH_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            aria-label="调研主题"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如：机器人产业链 - 减速器与端侧智能"
          />
          <GlassButton
            className="research-submit"
            tone="primary"
            refraction
            type="submit"
            state={researchButtonState}
            loadingLabel="正在生成"
            successLabel="生成完成"
            errorLabel="重新生成"
            disabled={!topic.trim()}
          >
            生成报告
          </GlassButton>
        </form>
      </section>

      <section className="board">
        <div className="board-head">
          <div>
            <h2>板块压力监控</h2>
            <p className="muted">放量下杀 + 板块跑输 + 恐慌升温 + 资金逃离高 beta 的四维合成分</p>
          </div>
          <div className="button-row">
            <GlassButton
              state={pressureButtonState}
              loadingLabel={isSuperadmin ? "正在同步" : "正在加载"}
              successLabel={isSuperadmin ? "同步完成" : "加载完成"}
              errorLabel={isSuperadmin ? "重新同步" : "重新加载"}
              onClick={onPressureRefresh}
            >
              {isSuperadmin ? "同步压力" : "重新加载"}
            </GlassButton>
            {isSuperadmin && (
              <GlassButton
                state={dailyButtonState}
                loadingLabel="正在执行"
                successLabel="日更完成"
                errorLabel="重新执行"
                onClick={onDaily}
              >
                执行日更
              </GlassButton>
            )}
          </div>
        </div>
        {pressure.isLoading && !pressure.data && (
          <div className="pressure-grid pressure-skeleton-grid" role="status" aria-label="正在加载板块压力">
            <GlassSkeleton variant="pressure" />
            <GlassSkeleton variant="pressure" />
          </div>
        )}
        {pressure.isError && <div className="panel error-state" role="alert">压力数据加载失败 <GlassButton tone="text" size="sm" onClick={() => pressure.refetch()}>重试</GlassButton></div>}
        {pressure.data && pressure.data.length === 0 && (
          <p className="empty-inline">暂无压力数据，待日更采集日线后生成</p>
        )}
        <div className="pressure-grid content-ready" aria-busy={pressure.isFetching || undefined} data-refreshing={pressure.isFetching || undefined}>
          {pressure.data?.map((theme) => (
            <PressureCard key={theme.id} theme={theme} />
          ))}
        </div>
      </section>

      <section className="board">
        <div className="board-head">
          <div><h2>最近报告</h2><p className="muted">继续阅读最近写入知识库的研究成果</p></div>
          <GlassActionLink tone="secondary" to="/knowledge">查看全部</GlassActionLink>
        </div>
        {reports.isError && <div className="panel error-state" role="alert">最近报告加载失败 <GlassButton tone="text" size="sm" onClick={() => reports.refetch()}>重试</GlassButton></div>}
        <div className="recent-report-list content-ready" aria-busy={reports.isLoading || undefined}>
          {reports.isLoading && !reports.data && Array.from({ length: 4 }, (_, index) => (
            <GlassSkeleton key={index} variant="report" />
          ))}
          {reports.data?.slice(0, 6).map((report) => (
            <Link className="recent-report-row" key={report.id} to={report.content_status === "ok" ? `/reports/${encodeURIComponent(report.id)}` : "/knowledge"}>
              <div><strong>{report.title}</strong><span className="muted">{report.topic}</span></div>
              <time>{report.local_date ?? report.created_at.slice(0, 10)}</time>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
