import { useState, useEffect, useRef } from "preact/hooks";
import { stocks, positions, loadPortfolio, showToast } from "../store.js";
import { get, post, del } from "../api.js";

export function Portfolio() {
  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>投资组合</h1>
        <p class="page-description">自选股与持仓统一管理，AI 自动生成投研分析。</p>
      </div>
      <StockSection />
      <PositionSection />
    </div>
  );
}

function useAnalysisPoller(items) {
  const timer = useRef(null);
  useEffect(() => {
    const hasAnalyzing = items.some(i => i.analysisStatus === "analyzing");
    if (hasAnalyzing && !timer.current) {
      timer.current = setInterval(() => loadPortfolio(), 3000);
    } else if (!hasAnalyzing && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [items]);
}

function StockSection() {
  const [form, setForm] = useState({ code: "", name: "", market: "A股" });
  const [busy, setBusy] = useState(false);
  useAnalysisPoller(stocks.value);

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post("/api/stocks", form); setForm({ code: "", name: "", market: "A股" }); await loadPortfolio(); showToast("已添加，AI 分析中..."); }
    finally { setBusy(false); }
  };

  const handleDelete = async (code) => { await del(`/api/stocks/${encodeURIComponent(code)}`); await loadPortfolio(); showToast("已删除"); };
  const handleReanalyze = async (code) => { await post(`/api/stocks/${encodeURIComponent(code)}/analyze`); await loadPortfolio(); showToast("重新分析中..."); };

  return (
    <section class="board route-panel">
      <div class="board-head"><div><h2>自选股</h2><p>{stocks.value.length} 只标的</p></div></div>
      <div class="route-form-wrap">
        <form class="business-form" onSubmit={handleSubmit}>
          <input required placeholder="代码" value={form.code} onInput={e => setForm({ ...form, code: e.target.value })} />
          <input required placeholder="名称" value={form.name} onInput={e => setForm({ ...form, name: e.target.value })} />
          <select value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}><option>A股</option><option>港股</option><option>美股</option></select>
          <button type="submit" disabled={busy}>新增</button>
        </form>
      </div>
      <div class="route-card-grid">
        {stocks.value.map(s => <StockCard key={s.code} stock={s} onDelete={handleDelete} onReanalyze={handleReanalyze} />)}
      </div>
    </section>
  );
}

function StockCard({ stock: s, onDelete, onReanalyze }) {
  return (
    <article class="route-card">
      <h2>{s.name}（{s.code}）</h2>
      <span class="mini-label">{s.market} · {s.status}</span>
      <AnalysisContent status={s.analysisStatus} fields={[
        { label: "关注理由", value: s.thesis },
        { label: "建议", value: s.advice },
        { label: "风险", value: s.risk },
      ]} />
      <div style="margin-top:8px;display:flex;gap:6px">
        {s.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => onReanalyze(s.code)}>重新分析</button>}
        <button class="ghost-button danger" onClick={() => onDelete(s.code)}>删除</button>
      </div>
    </article>
  );
}

function PositionSection() {
  const [form, setForm] = useState({ code: "", name: "", market: "A股", shares: "", cost: "" });
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const [prices, setPrices] = useState({});
  const searchTimer = useRef(null);
  useAnalysisPoller(positions.value);

  // 加载持仓实时价格
  useEffect(() => {
    if (!positions.value.length) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const p of positions.value) {
        try {
          const res = await get(`/api/search?q=${encodeURIComponent(p.code)}`);
          const match = (res.results || []).find(r => r.code === p.code);
          if (match) {
            const q = await get(`/api/quote/${encodeURIComponent(match.secid)}`);
            if (q && !cancelled) map[p.code] = q.price;
          }
        } catch {}
      }
      if (!cancelled) setPrices(map);
    })();
    return () => { cancelled = true; };
  }, [positions.value]);

  const handleSearch = (val) => {
    setForm(f => ({ ...f, code: val, name: "", market: "A股" }));
    setQuote(null);
    clearTimeout(searchTimer.current);
    if (val.length < 1) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await get(`/api/search?q=${encodeURIComponent(val)}`);
        setSuggestions(res.results || []);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const handleSelect = async (item) => {
    setForm(f => ({ ...f, code: item.code, name: item.name, market: item.market }));
    setSuggestions([]);
    try {
      const q = await get(`/api/quote/${encodeURIComponent(item.secid)}`);
      setQuote(q);
    } catch { setQuote(null); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post("/api/positions", form); setForm({ code: "", name: "", market: "A股", shares: "", cost: "" }); setQuote(null); await loadPortfolio(); showToast("已添加，AI 分析中..."); }
    finally { setBusy(false); }
  };

  const handleDelete = async (id) => { await del(`/api/positions/${encodeURIComponent(id)}`); await loadPortfolio(); showToast("已删除"); };
  const handleReanalyze = async (id) => { await post(`/api/positions/${encodeURIComponent(id)}/analyze`); await loadPortfolio(); showToast("重新分析中..."); };

  const totalCost = positions.value.reduce((s, p) => s + p.shares * p.cost, 0);
  const totalMarketValue = positions.value.reduce((s, p) => s + p.shares * (prices[p.code] || p.cost), 0);
  const totalPnl = totalMarketValue - totalCost;
  const totalPnlPct = totalCost ? ((totalPnl / totalCost) * 100).toFixed(2) : "0.00";

  return (
    <section class="board route-panel">
      <div class="board-head"><div>
        <h2>持仓</h2>
        <p>{positions.value.length} 只 · 市值 ¥{totalMarketValue.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} · <span style={`color:${totalPnl >= 0 ? "var(--red)" : "#22c55e"}`}>{totalPnl >= 0 ? "+" : ""}{totalPnl.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}（{totalPnlPct}%）</span></p>
      </div></div>
      <div class="route-form-wrap">
        <form class="business-form" onSubmit={handleSubmit} style="grid-template-columns: 1fr 1fr 100px 100px 80px">
          <div style="position:relative">
            <input required placeholder="代码或名称搜索" value={form.code} onInput={e => handleSearch(e.target.value)} autocomplete="off" />
            {suggestions.length > 0 && (
              <div class="search-dropdown">
                {suggestions.map(s => (
                  <div key={s.secid} class="search-dropdown-item" onClick={() => handleSelect(s)}>
                    <b>{s.code}</b> {s.name} <span style="color:var(--muted);font-size:11px">{s.market}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input placeholder="名称（自动填充）" value={form.name} readOnly style={form.name ? "background:#f0f7ff" : ""} />
          <input type="number" placeholder="数量" value={form.shares} onInput={e => setForm({ ...form, shares: e.target.value })} />
          <input type="number" step="0.001" placeholder="成本价" value={form.cost} onInput={e => setForm({ ...form, cost: e.target.value })} />
          <button type="submit" disabled={busy}>新增</button>
        </form>
        {quote && <p style="margin:6px 0 0;font-size:13px;color:var(--accent)">当前价：¥{quote.price.toFixed(2)}（{quote.changePct}%）</p>}
      </div>
      <div class="route-card-grid">
        {positions.value.map(p => {
          const curPrice = prices[p.code];
          const pnl = curPrice ? (curPrice - p.cost) * p.shares : null;
          const pnlPct = curPrice && p.cost ? (((curPrice - p.cost) / p.cost) * 100).toFixed(2) : null;
          return (
            <article key={p.id} class="route-card">
              <h2>{p.name}（{p.code}）</h2>
              <span class="mini-label">{p.market} · {p.shares}股 · 成本{p.cost}</span>
              {curPrice && (
                <p style={`margin:4px 0;font-size:13px;font-weight:500;color:${pnl >= 0 ? "var(--red)" : "#22c55e"}`}>
                  现价 {curPrice.toFixed(3)} · {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}元（{pnlPct}%）
                </p>
              )}
              <AnalysisContent status={p.analysisStatus} fields={[
                { label: "理由", value: p.reason },
                { label: "风险", value: p.risk },
              ]} />
              <div style="margin-top:8px;display:flex;gap:6px">
                {p.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => handleReanalyze(p.id)}>重新分析</button>}
                <button class="ghost-button danger" onClick={() => handleDelete(p.id)}>删除</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AnalysisContent({ status, fields }) {
  if (status === "analyzing") return <p style="color:var(--accent);font-size:13px;margin:8px 0">AI 分析中...</p>;
  if (status === "failed") return <p style="color:var(--red);font-size:13px;margin:8px 0">分析失败，请重试或检查 LLM 配置</p>;
  if (status === "pending") return <p style="color:var(--muted);font-size:13px;margin:8px 0">等待分析</p>;
  return (<>{fields.map(f => f.value ? <p key={f.label} style="margin:4px 0;font-size:13px"><b>{f.label}：</b>{f.value}</p> : null)}</>);
}
