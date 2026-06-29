import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { stocks, positions, indices, loadPortfolio, showToast } from "../store.js";
import { get, post, del } from "../api.js";

const TABS = [
  { key: "positions", label: "持仓" },
  { key: "stocks", label: "自选股" },
  { key: "etfs", label: "指数基金" }
];

export function Portfolio() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedKey, setSelectedKey] = useState("");
  const prices = usePositionPrices(positions.value);
  const holdings = useMemo(() => buildHoldings(positions.value, prices), [positions.value, prices]);
  const etfs = indices.value.filter(i => i.relatedEtfs?.length > 0);

  useAnalysisPoller([...stocks.value, ...positions.value]);

  useEffect(() => { setSelectedKey(""); }, [activeTab]);

  const selected = getSelected(activeTab, selectedKey, holdings, stocks.value, etfs);
  const overview = getOverview(holdings, stocks.value, etfs);

  const handleSelect = (key) => setSelectedKey(String(key));
  const handleTab = (key) => { setActiveTab(key); setSelectedKey(""); };

  return (
    <div class="nav-page portfolio-page">
      <div class="page-head portfolio-head">
        <div>
          <h1>投资组合</h1>
          <p class="page-description">用表格快速扫描，用详情区阅读 AI 分析和风险复核。</p>
        </div>
      </div>

      <PortfolioOverview overview={overview} />

      <section class="portfolio-workbench">
        <div class="portfolio-tabs" role="tablist" aria-label="投资组合视图">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              class={`portfolio-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => handleTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div class="portfolio-layout">
          <div class="portfolio-main">
            {activeTab === "positions" && (
              <PositionPanel holdings={holdings} selectedKey={selectedKey} onSelect={handleSelect} />
            )}
            {activeTab === "stocks" && (
              <StockPanel selectedKey={selectedKey} onSelect={handleSelect} />
            )}
            {activeTab === "etfs" && (
              <EtfPanel etfs={etfs} selectedKey={selectedKey} onSelect={handleSelect} />
            )}
          </div>

          <DetailPanel activeTab={activeTab} selected={selected} />
        </div>
      </section>
    </div>
  );
}

function useAnalysisPoller(items) {
  const timer = useRef(null);
  const signature = items.map(i => `${i.id || i.code}:${i.analysisStatus}`).join("|");
  useEffect(() => {
    const hasAnalyzing = items.some(i => i.analysisStatus === "analyzing");
    if (hasAnalyzing && !timer.current) {
      timer.current = setInterval(() => loadPortfolio(), 3000);
    } else if (!hasAnalyzing && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [signature]);
}

function usePositionPrices(items) {
  const [quotes, setQuotes] = useState({});
  const codes = items.map(p => p.code).join("|");
  useEffect(() => {
    if (!items.length) { setQuotes({}); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      for (const p of items) {
        try {
          const res = await get(`/api/search?q=${encodeURIComponent(p.code)}`);
          const match = (res.results || []).find(r => r.code === p.code);
          if (match) {
            const q = await get(`/api/quote/${encodeURIComponent(match.secid)}`);
            if (q) map[p.code] = q;
          }
        } catch {}
      }
      if (!cancelled) setQuotes(map);
    })();
    return () => { cancelled = true; };
  }, [codes]);
  return quotes;
}

function PortfolioOverview({ overview }) {
  return (
    <div class="portfolio-summary">
      <SummaryMetric label="总市值" value={formatMoney(overview.marketValue)} hint={`${overview.positionCount} 只持仓`} />
      <SummaryMetric label="浮动盈亏" value={formatSignedMoney(overview.pnl)} hint={`${formatSignedPct(overview.pnlPct)}`} tone={overview.pnl >= 0 ? "up" : "down"} />
      <SummaryMetric label="AI 待处理" value={overview.analyzingCount} hint="分析中 / 失败" tone={overview.analyzingCount ? "warn" : ""} />
      <SummaryMetric label="高风险提示" value={overview.highRiskCount} hint="需复核标的" tone={overview.highRiskCount ? "warn" : ""} />
    </div>
  );
}

function SummaryMetric({ label, value, hint, tone = "" }) {
  return (
    <div class={`summary-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function PositionPanel({ holdings, selectedKey, onSelect }) {
  const [form, setForm] = useState({ code: "", name: "", market: "A股", shares: "", cost: "" });
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const searchTimer = useRef(null);

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
    e.preventDefault();
    setBusy(true);
    try {
      const created = await post("/api/positions", form);
      pendingAnimate.add(created.id || form.code);
      setForm({ code: "", name: "", market: "A股", shares: "", cost: "" });
      setQuote(null);
      await loadPortfolio();
      onSelect(created.id || form.code);
      showToast("已添加，AI 分析中...");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelHeader title="持仓明细" subtitle="按仓位、盈亏和风险快速扫描">
        <CompactPositionForm
          form={form}
          busy={busy}
          suggestions={suggestions}
          quote={quote}
          onSubmit={handleSubmit}
          onSearch={handleSearch}
          onSelect={handleSelect}
          onChange={setForm}
        />
      </PanelHeader>

      <div class="portfolio-table-wrap">
        <div class="portfolio-table position-table">
          <div class="portfolio-table-head">
            <span>标的</span><span>仓位</span><span>成本 / 现价</span><span>浮动盈亏</span><span>AI 建议</span><span>风险</span><span>操作</span>
          </div>
          {holdings.length ? holdings.map(row => (
            <PositionRow key={row.id} row={row} active={String(selectedKey || holdings[0]?.id) === String(row.id)} onSelect={onSelect} />
          )) : <EmptyTable text="暂无持仓，先添加一个标的。" />}
        </div>
      </div>
    </>
  );
}

function CompactPositionForm({ form, busy, suggestions, quote, onSubmit, onSearch, onSelect, onChange }) {
  return (
    <form class="compact-form position-form" onSubmit={onSubmit}>
      <SearchField value={form.code} suggestions={suggestions} onInput={onSearch} onSelect={onSelect} />
      <input placeholder="名称" value={form.name} readOnly />
      <input type="number" placeholder="数量" value={form.shares} onInput={e => onChange({ ...form, shares: e.target.value })} />
      <input type="number" step="0.001" placeholder="成本价" value={form.cost} onInput={e => onChange({ ...form, cost: e.target.value })} />
      <button type="submit" disabled={busy}>新增</button>
      {quote && <span class="quote-hint">{formatQuoteHint(quote)}</span>}
    </form>
  );
}

function PositionRow({ row, active, onSelect }) {
  return (
    <button type="button" class={`portfolio-row ${active ? "active" : ""}`} onClick={() => onSelect(row.id)}>
      <span class="security-cell">
        <strong>{row.name}</strong>
        <em>{row.code} · {row.market} · {formatNumber(row.shares)}股</em>
      </span>
      <span>{row.weight ? `${row.weight.toFixed(1)}%` : "-"}</span>
      <span>
        <strong>{formatMoney(row.cost, 3)}</strong>
        <em>{row.price ? formatMoney(row.price, 3) : "无行情"}</em>
      </span>
      <span class={row.pnl >= 0 ? "money-up" : "money-down"}>
        <strong>{row.price ? formatSignedMoney(row.pnl) : "-"}</strong>
        <em>{row.price ? formatSignedPct(row.pnlPct) : "待更新"}</em>
      </span>
      <span><ActionChip text={row.reason} status={row.analysisStatus} /></span>
      <span><RiskBadge text={row.risk} status={row.analysisStatus} /></span>
      <span class="row-actions">查看</span>
    </button>
  );
}

function StockPanel({ selectedKey, onSelect }) {
  const [form, setForm] = useState({ code: "", name: "", market: "A股" });
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const searchTimer = useRef(null);

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
    e.preventDefault();
    setBusy(true);
    try {
      const created = await post("/api/stocks", form);
      pendingAnimate.add(created.code || form.code);
      setForm({ code: "", name: "", market: "A股" });
      setQuote(null);
      await loadPortfolio();
      onSelect(created.code || form.code);
      showToast("已添加，AI 分析中...");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelHeader title="自选股" subtitle={`${stocks.value.length} 只标的，重点看建议、风险和观察理由`}>
        <form class="compact-form stock-form" onSubmit={handleSubmit}>
          <SearchField value={form.code} suggestions={suggestions} onInput={handleSearch} onSelect={handleSelect} />
          <input placeholder="名称" value={form.name} readOnly />
          <button type="submit" disabled={busy}>新增</button>
          {quote && <span class="quote-hint">{formatQuoteHint(quote)}</span>}
        </form>
      </PanelHeader>

      <div class="portfolio-table-wrap">
        <div class="portfolio-table stock-table">
          <div class="portfolio-table-head">
            <span>标的</span><span>市场</span><span>状态</span><span>AI 建议</span><span>风险</span><span>更新</span><span>操作</span>
          </div>
          {stocks.value.length ? stocks.value.map(row => (
            <StockRow key={row.code} row={row} active={String(selectedKey || stocks.value[0]?.code) === String(row.code)} onSelect={onSelect} />
          )) : <EmptyTable text="暂无自选股，先添加一个观察标的。" />}
        </div>
      </div>
    </>
  );
}

function StockRow({ row, active, onSelect }) {
  return (
    <button type="button" class={`portfolio-row ${active ? "active" : ""}`} onClick={() => onSelect(row.code)}>
      <span class="security-cell">
        <strong>{row.name}</strong>
        <em>{row.code}</em>
      </span>
      <span>{row.market}</span>
      <span><StatusPill text={row.status || "观察"} /></span>
      <span><ActionChip text={row.advice} status={row.analysisStatus} /></span>
      <span><RiskBadge text={row.risk} status={row.analysisStatus} /></span>
      <span>{formatDate(row.updatedAt || row.updated_at)}</span>
      <span class="row-actions">查看</span>
    </button>
  );
}

function EtfPanel({ etfs, selectedKey, onSelect }) {
  return (
    <>
      <PanelHeader title="指数基金" subtitle="指数、关联 ETF 与基金方向集中查看" />
      <div class="portfolio-table-wrap">
        <div class="portfolio-table etf-table">
          <div class="portfolio-table-head">
            <span>指数</span><span>区域</span><span>点位</span><span>涨跌</span><span>关联 ETF / 基金</span><span>操作</span>
          </div>
          {etfs.length ? etfs.map(row => (
            <button type="button" key={row.code} class={`portfolio-row ${String(selectedKey || etfs[0]?.code) === String(row.code) ? "active" : ""}`} onClick={() => onSelect(row.code)}>
              <span class="security-cell"><strong>{row.name}</strong><em>{row.code}</em></span>
              <span>{row.region}</span>
              <span>{row.level || "-"}</span>
              <span class={String(row.changePct || "").startsWith("-") ? "money-down" : "money-up"}>{row.changePct || "-"}</span>
              <span class="muted-text">{(row.relatedEtfs || []).slice(0, 3).join("、")}</span>
              <span class="row-actions">查看</span>
            </button>
          )) : <EmptyTable text="暂无指数基金映射。" />}
        </div>
      </div>
    </>
  );
}

function PanelHeader({ title, subtitle, children }) {
  return (
    <div class="portfolio-panel-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function SearchField({ value, suggestions, onInput, onSelect }) {
  return (
    <div class="compact-search">
      <input required placeholder="代码或名称搜索" value={value} onInput={e => onInput(e.target.value)} autocomplete="off" />
      {suggestions.length > 0 && (
        <div class="search-dropdown">
          {suggestions.map(s => (
            <div key={s.secid} class="search-dropdown-item" onClick={() => onSelect(s)}>
              <b>{s.code}</b> {s.name} <span>{s.market}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ activeTab, selected }) {
  if (!selected) {
    return (
      <aside class="portfolio-detail">
        <div class="detail-empty">选择一行查看分析详情。</div>
      </aside>
    );
  }
  if (activeTab === "positions") return <PositionDetail row={selected} />;
  if (activeTab === "stocks") return <StockDetail row={selected} />;
  return <EtfDetail row={selected} />;
}

function PositionDetail({ row }) {
  const animate = pendingAnimate.has(row.id) && row.analysisStatus === "done";
  if (animate) pendingAnimate.delete(row.id);
  const AnalysisComp = animate ? AnalysisContentAnimated : AnalysisContent;

  return (
    <aside class="portfolio-detail">
      <DetailTitle title={row.name} meta={`${row.code} · ${row.market} · ${formatNumber(row.shares)}股`} />
      <div class="detail-metrics">
        <MiniMetric label="市值" value={formatMoney(row.marketValue)} />
        <MiniMetric label="成本" value={formatMoney(row.costValue)} />
        <MiniMetric label="盈亏" value={row.price ? `${formatSignedMoney(row.pnl)} / ${formatSignedPct(row.pnlPct)}` : "待更新"} tone={row.pnl >= 0 ? "up" : "down"} />
      </div>
      <div class="detail-chip-row">
        <ActionChip text={row.reason} status={row.analysisStatus} />
        <RiskBadge text={row.risk} status={row.analysisStatus} />
      </div>
      <AnalysisComp status={row.analysisStatus} fields={[
        { label: "理由", value: row.reason },
        { label: "风险", value: row.risk },
      ]} />
      <DetailActions>
        {row.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => reanalyzePosition(row.id)}>重新分析</button>}
        <button class="ghost-button danger" onClick={() => deletePosition(row.id)}>删除持仓</button>
      </DetailActions>
    </aside>
  );
}

function StockDetail({ row }) {
  const animate = pendingAnimate.has(row.code) && row.analysisStatus === "done";
  if (animate) pendingAnimate.delete(row.code);
  const AnalysisComp = animate ? AnalysisContentAnimated : AnalysisContent;

  return (
    <aside class="portfolio-detail">
      <DetailTitle title={row.name} meta={`${row.code} · ${row.market} · ${row.status || "观察"}`} />
      <div class="detail-chip-row">
        <ActionChip text={row.advice} status={row.analysisStatus} />
        <RiskBadge text={row.risk} status={row.analysisStatus} />
        <StatusPill text={statusText(row.analysisStatus)} />
      </div>
      <AnalysisComp status={row.analysisStatus} fields={[
        { label: "关注理由", value: row.thesis },
        { label: "建议", value: row.advice },
        { label: "风险", value: row.risk },
      ]} />
      {row.watchSignals?.length > 0 && (
        <div class="watch-signals">
          <span>观察信号</span>
          <div>{row.watchSignals.map(item => <em key={item}>{item}</em>)}</div>
        </div>
      )}
      <DetailActions>
        {row.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => reanalyzeStock(row.code)}>重新分析</button>}
        <button class="ghost-button danger" onClick={() => deleteStock(row.code)}>删除自选</button>
      </DetailActions>
    </aside>
  );
}

function EtfDetail({ row }) {
  return (
    <aside class="portfolio-detail">
      <DetailTitle title={row.name} meta={`${row.code} · ${row.region}`} />
      <div class="detail-metrics">
        <MiniMetric label="点位" value={row.level || "-"} />
        <MiniMetric label="涨跌" value={row.changePct || "-"} tone={String(row.changePct || "").startsWith("-") ? "down" : "up"} />
      </div>
      <div class="watch-signals">
        <span>关联 ETF / 基金</span>
        <div>{(row.relatedEtfs || []).map(item => <em key={item}>{item}</em>)}</div>
      </div>
    </aside>
  );
}

function DetailTitle({ title, meta }) {
  return (
    <div class="detail-title">
      <h2>{title}</h2>
      <p>{meta}</p>
    </div>
  );
}

function MiniMetric({ label, value, tone = "" }) {
  return (
    <div class={`mini-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailActions({ children }) {
  return <div class="detail-actions">{children}</div>;
}

function EmptyTable({ text }) {
  return <div class="empty-table">{text}</div>;
}

const pendingAnimate = new Set();

async function reanalyzeStock(code) {
  await post(`/api/stocks/${encodeURIComponent(code)}/analyze`);
  pendingAnimate.add(code);
  await loadPortfolio();
  showToast("重新分析中...");
}

async function deleteStock(code) {
  await del(`/api/stocks/${encodeURIComponent(code)}`);
  await loadPortfolio();
  showToast("已删除");
}

async function reanalyzePosition(id) {
  await post(`/api/positions/${encodeURIComponent(id)}/analyze`);
  pendingAnimate.add(id);
  await loadPortfolio();
  showToast("重新分析中...");
}

async function deletePosition(id) {
  await del(`/api/positions/${encodeURIComponent(id)}`);
  await loadPortfolio();
  showToast("已删除");
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

function buildHoldings(items, prices) {
  const rows = items.map(p => {
    const quote = prices[p.code];
    const price = typeof quote === "number" ? quote : quote?.price;
    const costValue = Number(p.shares || 0) * Number(p.cost || 0);
    const marketValue = Number(p.shares || 0) * Number(price || p.cost || 0);
    const pnl = marketValue - costValue;
    const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
    return { ...p, market: quote?.market || p.market, price, quoteSource: quote?.sourceLabel, costValue, marketValue, pnl, pnlPct };
  });
  const totalMarket = rows.reduce((sum, row) => sum + row.marketValue, 0);
  return rows.map(row => ({ ...row, weight: totalMarket ? (row.marketValue / totalMarket) * 100 : 0 }));
}

function getOverview(holdings, stockRows, etfs) {
  const cost = holdings.reduce((sum, row) => sum + row.costValue, 0);
  const marketValue = holdings.reduce((sum, row) => sum + row.marketValue, 0);
  const pnl = marketValue - cost;
  const analyzingCount = [...holdings, ...stockRows].filter(row => ["analyzing", "failed"].includes(row.analysisStatus)).length;
  const highRiskCount = [...holdings, ...stockRows].filter(row => riskLevel(row.risk) === "high").length;
  return {
    marketValue,
    pnl,
    pnlPct: cost ? (pnl / cost) * 100 : 0,
    analyzingCount,
    highRiskCount,
    positionCount: holdings.length,
    stockCount: stockRows.length,
    etfCount: etfs.length
  };
}

function getSelected(activeTab, selectedKey, holdings, stockRows, etfs) {
  if (activeTab === "positions") return holdings.find(row => String(row.id) === String(selectedKey)) || holdings[0];
  if (activeTab === "stocks") return stockRows.find(row => String(row.code) === String(selectedKey)) || stockRows[0];
  return etfs.find(row => String(row.code) === String(selectedKey)) || etfs[0];
}

function ActionChip({ text, status }) {
  const label = actionLabel(text, status);
  return <span class={`action-chip ${label === "分析中" ? "working" : ""}`}>{label}</span>;
}

function RiskBadge({ text, status }) {
  if (status === "analyzing") return <span class="risk-badge muted">分析中</span>;
  if (status === "failed") return <span class="risk-badge high">失败</span>;
  const level = riskLevel(text);
  const label = level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
  return <span class={`risk-badge ${level}`}>{label}</span>;
}

function StatusPill({ text }) {
  return <span class="status-pill">{text}</span>;
}

function actionLabel(text = "", status = "") {
  if (status === "analyzing") return "分析中";
  if (status === "failed") return "待重试";
  if (/止损/.test(text)) return "止损";
  if (/止盈/.test(text)) return "止盈";
  if (/减仓/.test(text)) return "减仓";
  if (/加仓/.test(text)) return "加仓";
  if (/持有/.test(text)) return "持有";
  if (/观察|关注/.test(text)) return "观察";
  return text ? "待复核" : "待分析";
}

function riskLevel(text = "") {
  if (!text) return "low";
  if (/止损|跌破|失效|威胁|高风险|替代|下调|回调/.test(text)) return "high";
  if (/波动|不及预期|需求|政策|竞争|估值/.test(text)) return "medium";
  return "low";
}

function statusText(status) {
  if (status === "done") return "已分析";
  if (status === "analyzing") return "分析中";
  if (status === "failed") return "失败";
  return "待分析";
}

function formatMoney(value, digits = 0) {
  const n = Number(value || 0);
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${formatMoney(n)}`;
}

function formatSignedPct(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatQuoteHint(quote) {
  const pct = quote.changePct == null ? "" : ` · ${formatSignedPct(quote.changePct)}`;
  const source = quote.sourceLabel ? ` · ${quote.sourceLabel}` : "";
  return `现价 ${formatMoney(quote.price, 3)}${pct}${source}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}-${date.getDate()}`;
}
