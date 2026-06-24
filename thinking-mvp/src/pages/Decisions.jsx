import { useState } from "preact/hooks";
import { decisions, refresh, showToast } from "../store.js";
import { post } from "../api.js";

export function Decisions() {
  const [busy, setBusy] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    try { await post("/api/decisions/daily"); await refresh(); showToast("决策指南已生成"); }
    finally { setBusy(false); }
  };

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>决策</h1>
        <p class="page-description">基于市场、自选股、持仓和当日报告生成每日决策指南。</p>
      </div>
      <section class="board route-panel">
        <div class="board-head">
          <div><h2>决策指南</h2><p>{decisions.value.length} 条记录</p></div>
          <button class="ghost-button primary-action" onClick={handleGenerate} disabled={busy}>生成今日决策</button>
        </div>
        <div class="route-card-grid">
          {decisions.value.map(d => (
            <article key={d.id} class="route-card">
              <h2>{d.title}</h2>
              <span class="mini-label">{new Date(d.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <p>{d.summary}</p>
              <p><b>行动：</b>{d.action}</p>
              <p><b>市场：</b>{d.market || "待接入"}</p>
            </article>
          ))}
          {!decisions.value.length && <div class="empty-state"><p>还没有决策指南。</p></div>}
        </div>
      </section>
    </div>
  );
}
