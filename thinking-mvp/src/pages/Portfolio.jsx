import { useState } from "preact/hooks";
import { stocks, positions, refresh, showToast } from "../store.js";
import { post, del } from "../api.js";

export function Portfolio() {
  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>投资组合</h1>
        <p class="page-description">自选股与持仓统一管理。</p>
      </div>
      <StockSection />
      <PositionSection />
    </div>
  );
}

function StockSection() {
  const [form, setForm] = useState({ code: "", name: "", market: "A股", status: "观察", thesis: "", advice: "", risk: "", watchSignals: "" });
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post("/api/stocks", form); setForm({ code: "", name: "", market: "A股", status: "观察", thesis: "", advice: "", risk: "", watchSignals: "" }); await refresh(); showToast("自选股已保存"); }
    finally { setBusy(false); }
  };

  const handleDelete = async (code) => {
    await del(`/api/stocks/${encodeURIComponent(code)}`);
    await refresh(); showToast("已删除");
  };

  return (
    <section class="board route-panel">
      <div class="board-head"><div><h2>自选股</h2><p>{stocks.value.length} 只标的</p></div></div>
      <div class="route-form-wrap">
        <form class="business-form" onSubmit={handleSubmit}>
          <input required placeholder="代码" value={form.code} onInput={e => setForm({ ...form, code: e.target.value })} />
          <input required placeholder="名称" value={form.name} onInput={e => setForm({ ...form, name: e.target.value })} />
          <select value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}><option>A股</option><option>港股</option><option>美股</option></select>
          <input placeholder="关注理由" value={form.thesis} onInput={e => setForm({ ...form, thesis: e.target.value })} />
          <button type="submit" disabled={busy}>新增</button>
        </form>
      </div>
      <div class="route-card-grid">
        {stocks.value.map(s => (
          <article key={s.code} class="route-card">
            <h2>{s.name}（{s.code}）</h2>
            <span class="mini-label">{s.market} · {s.status}</span>
            <p>{s.thesis}</p>
            {s.advice && <p><b>建议：</b>{s.advice}</p>}
            {s.risk && <p><b>风险：</b>{s.risk}</p>}
            <button class="ghost-button danger" onClick={() => handleDelete(s.code)}>删除</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function PositionSection() {
  const [form, setForm] = useState({ code: "", name: "", market: "A股", shares: "", cost: "", reason: "", risk: "" });
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post("/api/positions", form); setForm({ code: "", name: "", market: "A股", shares: "", cost: "", reason: "", risk: "" }); await refresh(); showToast("持仓已保存"); }
    finally { setBusy(false); }
  };

  const handleDelete = async (id) => {
    await del(`/api/positions/${encodeURIComponent(id)}`);
    await refresh(); showToast("已删除");
  };

  const totalCost = positions.value.reduce((s, p) => s + p.shares * p.cost, 0);

  return (
    <section class="board route-panel">
      <div class="board-head"><div><h2>持仓</h2><p>{positions.value.length} 只 · 总成本 ¥{totalCost.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</p></div></div>
      <div class="route-form-wrap">
        <form class="business-form" onSubmit={handleSubmit}>
          <input required placeholder="代码" value={form.code} onInput={e => setForm({ ...form, code: e.target.value })} />
          <input required placeholder="名称" value={form.name} onInput={e => setForm({ ...form, name: e.target.value })} />
          <input type="number" placeholder="数量" value={form.shares} onInput={e => setForm({ ...form, shares: e.target.value })} />
          <input type="number" step="0.001" placeholder="成本价" value={form.cost} onInput={e => setForm({ ...form, cost: e.target.value })} />
          <button type="submit" disabled={busy}>新增</button>
        </form>
      </div>
      <div class="route-card-grid">
        {positions.value.map(p => (
          <article key={p.id} class="route-card">
            <h2>{p.name}（{p.code}）</h2>
            <span class="mini-label">{p.market} · {p.shares}股 · 成本{p.cost}</span>
            {p.reason && <p><b>理由：</b>{p.reason}</p>}
            {p.risk && <p><b>风险：</b>{p.risk}</p>}
            <button class="ghost-button danger" onClick={() => handleDelete(p.id)}>删除</button>
          </article>
        ))}
      </div>
    </section>
  );
}
