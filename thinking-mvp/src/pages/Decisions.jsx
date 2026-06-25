import { useState } from "preact/hooks";
import { decisions, refresh, showToast } from "../store.js";
import { post } from "../api.js";

export function Decisions() {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const handleGenerate = async () => {
    setBusy(true);
    try { await post("/api/decisions/daily"); await refresh(); showToast("决策指南已更新"); }
    finally { setBusy(false); }
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const todayDecision = decisions.value.find(d => d.date === today);
  const history = decisions.value.filter(d => d.date !== today);

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>决策</h1>
        <p class="page-description">基于市场、持仓、自选股和当日报告，生成每日决策指南。每天一份，重复生成会更新。</p>
      </div>

      <section class="board route-panel">
        <div class="board-head">
          <div><h2>今日决策</h2><p>{today}</p></div>
          <button class="ghost-button primary-action" onClick={handleGenerate} disabled={busy}>
            {todayDecision ? "刷新今日决策" : "生成今日决策"}
          </button>
        </div>
        {todayDecision ? <DecisionDetail d={todayDecision} /> : (
          <div class="empty-state"><p>今日尚未生成决策指南，点击右上角按钮生成。</p></div>
        )}
      </section>

      {history.length > 0 && (
        <section class="board route-panel" style="margin-top:14px">
          <div class="board-head"><div><h2>历史决策</h2><p>{history.length} 条</p></div></div>
          <div class="route-list">
            {history.map(d => (
              <div key={d.id}>
                <div class="route-list-item" style="cursor:pointer" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  <span>{d.date}</span>
                  <strong>{expanded === d.id ? "▼" : "▶"} {d.title}</strong>
                </div>
                {expanded === d.id && <DecisionDetail d={d} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DecisionDetail({ d }) {
  return (
    <div style="padding:12px 16px;font-size:13px;line-height:1.8">
      <p><b>概况：</b>{d.summary}</p>
      <p><b>行动建议：</b>{d.action}</p>
      <p><b>市场环境：</b>{d.market || "待接入"}</p>
      {d.positionAdvice?.length > 0 && (
        <div style="margin-top:8px">
          <b>持仓建议：</b>
          <ul style="margin:4px 0;padding-left:18px">{d.positionAdvice.map(p => <li key={p.code}>{p.name}（{p.code}）— {p.advice}</li>)}</ul>
        </div>
      )}
      {d.stockAdvice?.length > 0 && (
        <div style="margin-top:8px">
          <b>自选股建议：</b>
          <ul style="margin:4px 0;padding-left:18px">{d.stockAdvice.map(s => <li key={s.code}>{s.name}（{s.code}）— {s.advice}{s.risk ? `；风险：${s.risk}` : ""}</li>)}</ul>
        </div>
      )}
      {d.reports?.length > 0 && (
        <div style="margin-top:8px">
          <b>关联报告：</b>
          <ul style="margin:4px 0;padding-left:18px">{d.reports.map(r => <li key={r.id}><a href={`#report/${encodeURIComponent(r.id)}`}>{r.title}</a></li>)}</ul>
        </div>
      )}
    </div>
  );
}
