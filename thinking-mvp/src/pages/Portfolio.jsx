import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { stocks, positions, indices, loadPortfolio, showToast } from "../store.js";
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
      <EtfSection />
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
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const searchTimer = useRef(null);
  useAnalysisPoller(stocks.value);

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
    try {
      const created = await post("/api/stocks", form);
      pendingAnimate.add(created.code || form.code);
      setForm({ code: "", name: "", market: "A股" });
      setQuote(null);
      await loadPortfolio();
      showToast("已添加，AI 分析中...");
    }
    finally { setBusy(false); }
  };

  const handleDelete = async (code) => { await del(`/api/stocks/${encodeURIComponent(code)}`); await loadPortfolio(); showToast("已删除"); };
  const handleReanalyze = async (code) => { await post(`/api/stocks/${encodeURIComponent(code)}/analyze`); pendingAnimate.add(code); await loadPortfolio(); showToast("重新分析中..."); };

  return (
    <section class="board route-panel">
      <div class="board-head"><div><h2>自选股</h2><p>{stocks.value.length} 只标的</p></div></div>
      <div class="route-form-wrap">
        <form class="business-form" onSubmit={handleSubmit} style="grid-template-columns: 1fr 1fr 80px">
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
          <button type="submit" disabled={busy}>新增</button>
        </form>
        {quote && <p style="margin:6px 0 0;font-size:13px;color:var(--accent)">当前价：¥{quote.price.toFixed(2)}（{quote.changePct}%）</p>}
      </div>
      <div class="route-card-grid">
        {stocks.value.map(s => <StockCard key={s.code} stock={s} onDelete={handleDelete} onReanalyze={handleReanalyze} />)}
      </div>
    </section>
  );
}

// 记录哪些 id 刚触发了重新分析，需要播放打字机
const pendingAnimate = new Set();

function StockCard({ stock: s, onDelete, onReanalyze }) {
  const animate = pendingAnimate.has(s.code) && s.analysisStatus === "done";
  if (animate) pendingAnimate.delete(s.code);
  return (
    <article class="route-card">
      <h2>{s.name}（{s.code}）</h2>
      <span class="mini-label">{s.market} · {s.status}</span>
      {animate ? (
        <AnalysisContentAnimated status={s.analysisStatus} fields={[
          { label: "关注理由", value: s.thesis },
          { label: "建议", value: s.advice },
          { label: "风险", value: s.risk },
        ]} />
      ) : (
        <AnalysisContent status={s.analysisStatus} fields={[
          { label: "关注理由", value: s.thesis },
          { label: "建议", value: s.advice },
          { label: "风险", value: s.risk },
        ]} />
      )}
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
    try {
      const created = await post("/api/positions", form);
      pendingAnimate.add(created.id || form.code);
      setForm({ code: "", name: "", market: "A股", shares: "", cost: "" });
      setQuote(null);
      await loadPortfolio();
      showToast("已添加，AI 分析中...");
    }
    finally { setBusy(false); }
  };

  const handleDelete = async (id) => { await del(`/api/positions/${encodeURIComponent(id)}`); await loadPortfolio(); showToast("已删除"); };
  const handleReanalyze = async (id) => { await post(`/api/positions/${encodeURIComponent(id)}/analyze`); pendingAnimate.add(id); await loadPortfolio(); showToast("重新分析中..."); };

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
          const animate = pendingAnimate.has(p.id) && p.analysisStatus === "done";
          if (animate) pendingAnimate.delete(p.id);
          const AnalysisComp = animate ? AnalysisContentAnimated : AnalysisContent;
          return (
            <article key={p.id} class="route-card">
              <h2>{p.name}（{p.code}）</h2>
              <span class="mini-label">{p.market} · {p.shares}股 · 成本{p.cost}</span>
              {curPrice && (
                <p style={`margin:4px 0;font-size:13px;font-weight:500;color:${pnl >= 0 ? "var(--red)" : "#22c55e"}`}>
                  现价 {curPrice.toFixed(3)} · {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}元（{pnlPct}%）
                </p>
              )}
              <AnalysisComp status={p.analysisStatus} fields={[
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
  if (status !== "done") return <AnalysisState status={status} />;
  const visibleFields = fields.filter(f => f.value);
  if (!visibleFields.length) return <AnalysisState status="empty" />;
  return (
    <div class="analysis-panel">
      {visibleFields.map(f => <AnalysisField key={f.label} label={f.label} text={f.value} />)}
    </div>
  );
}

function AnalysisContentAnimated({ status, fields }) {
  if (status !== "done") return <AnalysisState status={status} />;
  const visibleFields = fields.filter(f => f.value);
  if (!visibleFields.length) return <AnalysisState status="empty" />;
  return (
    <div class="analysis-panel analysis-panel-animated" aria-live="polite">
      {visibleFields.map((f, index) => (
        <TypewriterField key={f.label} label={f.label} text={f.value} delay={index * 180} />
      ))}
    </div>
  );
}

function AnalysisState({ status }) {
  if (status === "analyzing") {
    return (
      <div class="analysis-panel analysis-panel-working" aria-live="polite">
        <div class="analysis-status-line">
          <span class="analysis-pulse" />
          <span>AI 正在整理投研要点</span>
          <span class="analysis-dots"><i /><i /><i /></span>
        </div>
        <div class="analysis-skeleton"><span /><span /><span /></div>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div class="analysis-panel analysis-panel-message failed">
        <span>分析失败，请重试或检查 LLM 配置</span>
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div class="analysis-panel analysis-panel-message">
        <span>暂无分析内容</span>
      </div>
    );
  }
  return (
    <div class="analysis-panel analysis-panel-message">
      <span>等待分析</span>
    </div>
  );
}

function AnalysisField({ label, text }) {
  return (
    <div class="analysis-field">
      <span class="analysis-label">{label}</span>
      <p class="analysis-text">{text}</p>
    </div>
  );
}

function TypewriterField({ label, text, delay = 0 }) {
  const units = useMemo(() => splitGraphemes(text), [text]);
  const [len, setLen] = useState(0);
  const [active, setActive] = useState(false);
  const rafRef = useRef(null);
  const delayRef = useRef(null);
  useEffect(() => {
    let start = 0;
    const total = units.length;
    const chunk = total > 160 ? 3 : total > 80 ? 2 : 1;
    setLen(0);
    setActive(total > 0);
    if (!total) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setLen(total);
      setActive(false);
      return;
    }
    const step = (ts) => {
      if (!start) start = ts;
      const nextLen = Math.min(total, Math.floor((ts - start) / 24) * chunk + 1);
      setLen(nextLen);
      if (nextLen < total) rafRef.current = requestAnimationFrame(step);
      else setActive(false);
    };
    delayRef.current = setTimeout(() => { rafRef.current = requestAnimationFrame(step); }, delay);
    return () => {
      if (delayRef.current) clearTimeout(delayRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [units, delay]);
  return (
    <div class={`analysis-field ${active ? "active" : "done"}`}>
      <span class="analysis-label">{label}</span>
      <p class="analysis-text">
        {units.slice(0, len).join("")}
        {active && <span class="typing-caret" aria-hidden="true" />}
      </p>
    </div>
  );
}

const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" }) : null;
function splitGraphemes(text) {
  if (!text) return [];
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), part => part.segment);
}

function EtfSection() {
  const allEtfs = indices.value.filter(i => i.relatedEtfs?.length > 0);
  if (!allEtfs.length) return null;
  return (
    <section class="board route-panel" style="margin-top:14px">
      <div class="board-head"><div><h2>关联 ETF</h2><p>按指数映射的可投资 ETF 基金</p></div></div>
      <div style="padding:12px 16px;font-size:13px;line-height:2">
        {allEtfs.map(i => (
          <p key={i.code}><b>{i.name}：</b>{i.relatedEtfs.join("、")}</p>
        ))}
      </div>
    </section>
  );
}
