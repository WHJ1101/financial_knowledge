import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { BottomSheet } from "@/components/mobile/BottomSheet";
import {
  InstrumentPicker,
  type InstrumentQuickTarget,
} from "@/features/instruments/InstrumentPicker";
import type { InstrumentSelection } from "@/features/instruments/useInstruments";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import {
  useCancelDebate,
  useCreateDebate,
  useDebate,
  useDebates,
  useResumeDebate,
} from "@/hooks/useDebates";
import { useAddWatchlist, usePositions, useWatchlist } from "@/hooks/usePortfolio";
import { DebateDetail } from "@/pages/DebateDetail";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
};
const HORIZON_LABEL = { short: "短线（1-5 日）", swing: "波段（2-8 周）", long: "中长线（3-12 月）" };

const VERDICT_BADGE_CLASS: Record<string, string> = {
  偏多: "badge-bull",
  偏空: "badge-bear",
  中性: "badge-neutral",
};

function debateListBadgeClass(status: string, verdict: string | null) {
  const semanticClass = verdict ? VERDICT_BADGE_CLASS[verdict] : undefined;
  const toneClass = semanticClass ?? (status === "done" ? "badge-neutral" : `status-${status}`);
  return `badge debate-list-verdict ${toneClass}`;
}

export function DecisionsPage() {
  const capabilities = useInputCapabilities();
  const positions = usePositions();
  const watchlist = useWatchlist();
  const addWatchlist = useAddWatchlist();
  const debates = useDebates();
  const createDebate = useCreateDebate();
  const cancelDebate = useCancelDebate();
  const resumeDebate = useResumeDebate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<InstrumentSelection | null>(null);
  const [horizon, setHorizon] = useState<"short" | "swing" | "long">("swing");
  const [question, setQuestion] = useState("");
  const [showLauncher, setShowLauncher] = useState(false);
  const detail = useDebate(selectedId);

  const targets = useMemo(() => {
    const map = new Map<string, InstrumentQuickTarget>();
    positions.data?.forEach((item) => map.set(item.instrument_id, {
      id: item.instrument_id,
      name: item.name || item.code || item.instrument_id.slice(0, 8),
      display_code: item.code,
      market: item.market,
      group: "持仓",
    }));
    watchlist.data?.forEach((item) => {
      if (!map.has(item.instrument_id)) {
        map.set(item.instrument_id, {
          id: item.instrument_id,
          name: item.name || item.code || item.instrument_id.slice(0, 8),
          display_code: item.code,
          market: item.market,
          group: "自选",
        });
      }
    });
    return [...map.values()];
  }, [positions.data, watchlist.data]);

  useEffect(() => {
    if (!capabilities.isMobile && !selectedId && debates.data?.length) {
      setSelectedId(debates.data[0].id);
    }
  }, [capabilities.isMobile, debates.data, selectedId]);

  const onCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!instrument) return;
    createDebate.mutate(
      { instrument_id: instrument.id, horizon, question: question.trim() || undefined },
      {
        onSuccess: (result) => {
          setSelectedId(result.id);
          setQuestion("");
          setShowLauncher(false);
        },
      },
    );
  };

  const createError = createDebate.error instanceof ApiError
    ? createDebate.error.status === 422
      ? "请先在设置中添加并启用默认模型 Profile"
      : createDebate.error.status === 409
        ? "该标的已有进行中的辩论，请先查看或取消"
        : createDebate.error.detail
    : createDebate.error ? "辩论创建失败" : null;
  const cancelError = cancelDebate.error instanceof ApiError
    ? cancelDebate.error.detail
    : cancelDebate.error ? "取消辩论失败" : null;
  const resumeError = resumeDebate.error instanceof ApiError
    ? resumeDebate.error.status === 422
      ? "请先恢复可用的默认模型 Profile"
      : resumeDebate.error.status === 409
        ? "当前状态无法重试，或同一标的已有进行中的辩论"
        : resumeDebate.error.detail
    : resumeDebate.error ? "辩论重新入队失败" : null;

  const renderLauncher = (showTitle = true) => (
    <GlassPanel as="form" tone="control" className="decision-launcher" onSubmit={onCreate}>
      {showTitle && <h2>发起辩论</h2>}
      <div className="field-label">
        <span>标的</span>
        <InstrumentPicker selected={instrument} onSelect={setInstrument} quickTargets={targets} />
      </div>
      {(positions.isLoading || watchlist.isLoading) && (
        <p className="field-hint" aria-live="polite">持仓与自选标的加载中…</p>
      )}
      <label>
        投资周期
        <select value={horizon} onChange={(event) => setHorizon(event.target.value as typeof horizon)}>
          {Object.entries(HORIZON_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        关注问题（可选）
        <textarea
          rows={3}
          maxLength={500}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：当前估值是否已反映二季度增长？"
        />
      </label>
      {targets.length === 0 && !positions.isLoading && !watchlist.isLoading && !positions.isError && !watchlist.isError && (
        <p className="field-hint">可直接搜索任意标的发起辩论</p>
      )}
      {(positions.isError || watchlist.isError) && (
        <div className="inline-error" role="alert">
          标的加载失败
          <GlassButton tone="text" size="sm" type="button" onClick={() => {
            positions.refetch();
            watchlist.refetch();
          }}>重试</GlassButton>
        </div>
      )}
      <GlassButton tone="primary" refraction type="submit" disabled={!instrument || createDebate.isPending}>
        {createDebate.isPending ? "创建中…" : "发起辩论"}
      </GlassButton>
      {createError && <div className="login-error" role="alert">{createError}</div>}
    </GlassPanel>
  );

  return (
    <div className="page fade-up decisions-page">
      <header className="page-head decision-page-head">
        <div>
          <h1>决策辩论</h1>
          <p className="muted">四面分析、多空交叉反驳、裁判裁决和独立风险复核</p>
        </div>
        <div className="task-actions">
          {capabilities.isMobile && (
            <GlassButton tone="primary" refraction onClick={() => setShowLauncher(true)}>发起</GlassButton>
          )}
        </div>
      </header>

      <div className="decision-layout">
          <aside className={`decision-sidebar ${capabilities.isMobile && selectedId ? "mobile-hidden" : ""}`}>
            {!capabilities.isMobile && renderLauncher()}

            <GlassPanel as="section" tone="data" className="debate-history">
              <div className="section-heading compact">
                <h2>历史辩论</h2>
                <span className="muted">{debates.data?.length ?? 0}</span>
              </div>
              {debates.isLoading && <p className="muted" aria-live="polite">加载历史…</p>}
              {debates.isError && (
                <div className="inline-error" role="alert">加载失败 <GlassButton tone="text" size="sm" onClick={() => debates.refetch()}>重试</GlassButton></div>
              )}
              <ul className="debate-list">
                {debates.data?.map((item) => (
                  <li key={item.id}>
                    <button
                      className={item.id === selectedId ? "debate-list-item active" : "debate-list-item"}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="debate-list-main">
                        <strong>{item.instrument_name || item.instrument_code}</strong>
                        <span className="muted">{new Date(item.created_at).toLocaleString("zh-CN")}</span>
                      </span>
                      <span className={debateListBadgeClass(item.status, item.verdict)}>
                        {item.verdict ?? STATUS_LABEL[item.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {debates.data?.length === 0 && !debates.isError && <p className="empty-copy">还没有辩论记录</p>}
            </GlassPanel>
          </aside>

          <section className={`decision-detail ${capabilities.isMobile && !selectedId ? "mobile-hidden" : ""}`} aria-live="polite">
            {capabilities.isMobile && selectedId && (
              <GlassButton tone="text" className="mobile-detail-back" onClick={() => setSelectedId(null)}>
                ← 返回辩论列表
              </GlassButton>
            )}
            {!selectedId && <div className="panel empty-state">选择历史记录，或发起一场辩论</div>}
            {selectedId && detail.isLoading && <div className="panel loading-state">加载辩论详情…</div>}
            {selectedId && detail.isError && (
              <div className="panel error-state" role="alert">详情加载失败 <GlassButton tone="text" size="sm" onClick={() => detail.refetch()}>重试</GlassButton></div>
            )}
            {detail.data && (
              <>
                <DebateDetail
                  debate={detail.data}
                  onCancel={() => cancelDebate.mutate(detail.data.id)}
                  canceling={cancelDebate.isPending}
                  onResume={() => resumeDebate.mutate(detail.data.id)}
                  resuming={resumeDebate.isPending}
                  onRefresh={() => detail.refetch()}
                  refreshing={detail.isFetching}
                />
                {detail.data.status === "done"
                  && !targets.some((target) => target.id === detail.data?.instrument_id)
                  && (
                    <GlassPanel tone="control" className="debate-followup">
                      <div>
                        <strong>继续跟踪这个标的？</strong>
                        <p className="muted">加入自选后可持续记录观点和触发信号。</p>
                      </div>
                      <GlassButton
                        tone="secondary"
                        size="sm"
                        disabled={addWatchlist.isPending}
                        onClick={() => addWatchlist.mutate({
                          code: detail.data!.instrument_code,
                          name: detail.data!.instrument_name,
                          market: detail.data!.report?.target.market ?? "",
                          status: "watching",
                          thesis: detail.data!.question ?? undefined,
                        })}
                      >
                        {addWatchlist.isPending ? "加入中…" : "加入自选"}
                      </GlassButton>
                    </GlassPanel>
                  )}
                {addWatchlist.error && (
                  <div className="login-error" role="alert">
                    {addWatchlist.error instanceof ApiError ? addWatchlist.error.detail : "加入自选失败"}
                  </div>
                )}
                {cancelError && <div className="login-error" role="alert">{cancelError}</div>}
                {resumeError && <div className="login-error" role="alert">{resumeError}</div>}
              </>
            )}
          </section>
      </div>
      <BottomSheet
        open={showLauncher}
        title="发起辩论"
        onClose={() => setShowLauncher(false)}
        height="full"
        className="decision-launcher-sheet"
      >
        {renderLauncher(false)}
      </BottomSheet>
    </div>
  );
}
