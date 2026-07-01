import { useMemo, useState } from "preact/hooks";
import { signals, status, loadSignals, showToast } from "../store.js";
import { post } from "../api.js";

export function Signals() {
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const today = status.value?.now?.split("·")[1]?.trim()?.split(" ")[0] || localToday();

  const stats = useMemo(() => {
    const rows = signals.value;
    return {
      total: rows.length,
      today: rows.filter((item) => item.date === today).length,
      high: rows.filter((item) => Number(item.importance) >= 4).length,
      pending: rows.filter((item) => item.verificationStatus === "待验证").length
    };
  }, [signals.value, today]);

  let visible = signals.value;
  if (filter === "today") visible = visible.filter((item) => item.date === today);
  if (filter === "high") visible = visible.filter((item) => Number(item.importance) >= 4);
  if (filter === "pending") visible = visible.filter((item) => item.verificationStatus === "待验证");

  const handleSync = async () => {
    setBusy(true);
    try {
      const { result } = await post("/api/signals/sync", {});
      await loadSignals();
      showToast(result.ok ? `已同步 ${result.signalCount} 条社群信号` : result.reason || "社群信号同步未完成");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="nav-page signals-page">
      <div class="page-head signals-head">
        <div>
          <h1>信号源</h1>
          <p class="page-description">沉淀飞书社群、私域反馈和一线线索，进入日报前先结构化、去重和标记待验证。</p>
        </div>
        <button class="ghost-button primary-action" onClick={handleSync} disabled={busy}>
          {busy ? "同步中..." : "同步飞书"}
        </button>
      </div>

      <section class="signal-metrics">
        <Metric label="信号总数" value={stats.total} />
        <Metric label="今日新增" value={stats.today} />
        <Metric label="高优先级" value={stats.high} />
        <Metric label="待验证" value={stats.pending} />
      </section>

      <section class="board">
        <div class="board-head">
          <div>
            <h2>社群信号池</h2>
            <p>{visible.length} 条 · 按日期和重要性排序</p>
          </div>
          <div class="board-filters">
            {[
              ["all", "全部"],
              ["today", "今日"],
              ["high", "高优先级"],
              ["pending", "待验证"]
            ].map(([key, label]) => (
              <button key={key} class={`filter-btn ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {visible.length ? (
          <div class="signal-list">
            {visible.map((item) => <SignalRow key={item.id} item={item} />)}
          </div>
        ) : (
          <div class="empty-state"><p>暂无社群信号。点击“同步飞书”后，系统会读取授权文档并抽取信号卡。</p></div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div class="signal-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SignalRow({ item }) {
  return (
    <article class="signal-row">
      <div class="signal-score">
        <strong>{item.importance}</strong>
        <span>/5</span>
      </div>
      <div class="signal-main">
        <div class="signal-title-line">
          <strong>{item.summary}</strong>
          <span class={`signal-status ${statusClass(item.verificationStatus)}`}>{item.verificationStatus || "待验证"}</span>
        </div>
        <p>{item.evidence}</p>
        <div class="signal-tags">
          <span>{item.date}</span>
          <span>{item.theme || "未分类"}</span>
          <span>{item.signalType || "线索"}</span>
          <span>{confidenceLabel(item.confidence)}</span>
          {(item.relatedAssets || []).slice(0, 5).map((asset) => <span key={asset}>{asset}</span>)}
        </div>
      </div>
      <div class="signal-source">
        <span>{item.sourceTitle || "飞书知识源"}</span>
        {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">打开</a>}
      </div>
    </article>
  );
}

function statusClass(value) {
  if (value === "已验证") return "verified";
  if (value === "已证伪") return "rejected";
  return "pending";
}

function confidenceLabel(value) {
  return { low: "低置信", medium: "中置信", high: "高置信" }[value] || "中置信";
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
