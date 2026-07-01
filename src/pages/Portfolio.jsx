import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { stocks, positions, indices, loadPortfolio, showToast } from "../store.js";
import { get, post, put, del } from "../api.js";

const TABS = [
  { key: "positions", label: "持仓" },
  { key: "analysis", label: "组合分析" },
  { key: "stocks", label: "自选股" },
  { key: "etfs", label: "指数基金" }
];

const POSITION_SORT_OPTIONS = [
  { key: "default", label: "默认" },
  { key: "marketValue", label: "市值" },
  { key: "pnlPct", label: "收益率" }
];

export function Portfolio() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedKey, setSelectedKey] = useState("");
  const [positionSort, setPositionSort] = useState({ key: "default", direction: "desc" });
  const prices = usePositionPrices(positions.value);
  const holdings = useMemo(() => buildHoldings(positions.value, prices), [positions.value, prices]);
  const sortedHoldings = useMemo(() => sortHoldings(holdings, positionSort), [holdings, positionSort]);
  const portfolioAnalysis = useMemo(() => buildPortfolioAnalysis(holdings), [holdings]);
  const etfs = indices.value.filter(i => i.relatedEtfs?.length > 0);

  useAnalysisPoller([...stocks.value, ...positions.value]);

  useEffect(() => { setSelectedKey(""); }, [activeTab]);

  const selected = getSelected(activeTab, selectedKey, sortedHoldings, stocks.value, etfs);
  const overview = getOverview(holdings, stocks.value, etfs);

  const handleSelect = (key) => setSelectedKey(String(key));
  const handleTab = (key) => { setActiveTab(key); setSelectedKey(""); };
  const handlePositionSort = (key) => {
    setPositionSort(current => {
      if (key === "default") return { key: "default", direction: "desc" };
      if (current.key === key) {
        return { key, direction: current.direction === "desc" ? "asc" : "desc" };
      }
      return { key, direction: "desc" };
    });
  };

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

        <div class={`portfolio-layout ${activeTab === "analysis" ? "analysis-mode" : ""}`}>
          <div class="portfolio-main">
            {activeTab === "positions" && (
              <PositionPanel holdings={sortedHoldings} selectedKey={selectedKey} sort={positionSort} onSort={handlePositionSort} onSelect={handleSelect} />
            )}
            {activeTab === "analysis" && (
              <PortfolioAnalysisPanel analysis={portfolioAnalysis} />
            )}
            {activeTab === "stocks" && (
              <StockPanel selectedKey={selectedKey} onSelect={handleSelect} />
            )}
            {activeTab === "etfs" && (
              <EtfPanel etfs={etfs} selectedKey={selectedKey} onSelect={handleSelect} />
            )}
          </div>

          {activeTab !== "analysis" && <DetailPanel activeTab={activeTab} selected={selected} />}
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
          const directKey = positionQuoteKey(p);
          if (directKey) {
            const q = await get(`/api/quote/${encodeURIComponent(directKey)}`);
            if (q) { map[p.code] = q; continue; }
          }
          const res = await get(`/api/search?q=${encodeURIComponent(p.code)}`);
          const match = (res.results || []).find(r => r.code === p.code);
          if (!match) continue;
          const q = await get(`/api/quote/${encodeURIComponent(match.secid)}`);
          if (q) map[p.code] = q;
        } catch {}
      }
      if (!cancelled) setQuotes(map);
    })();
    return () => { cancelled = true; };
  }, [codes]);
  return quotes;
}

function positionQuoteKey(position) {
  if (position.quoteSecid) return position.quoteSecid;
  const code = String(position.code || "");
  if (position.market === "基金" || /^16\d{4}$/.test(code)) return code;
  return "";
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

function PositionPanel({ holdings, selectedKey, sort, onSort, onSelect }) {
  const [form, setForm] = useState({ code: "", name: "", market: "A股", quoteSecid: "", amount: "", marketValue: "", shares: "", cost: "" });
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const searchTimer = useRef(null);

  const handleSearch = (val) => {
    setForm(f => ({ ...f, code: val, name: "", market: "A股", quoteSecid: "" }));
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
    setForm(f => ({ ...f, code: item.code, name: item.name, market: item.market, quoteSecid: item.secid }));
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
      const payload = normalizePositionPayload(form, quote);
      const result = await post("/api/positions", payload);
      const created = result.position || result;
      pendingAnimate.add(created.id || form.code);
      setForm({ code: "", name: "", market: "A股", quoteSecid: "", amount: "", marketValue: "", shares: "", cost: "" });
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

      <div class="portfolio-sortbar" aria-label="持仓排序">
        <span>排序</span>
        {POSITION_SORT_OPTIONS.map(option => {
          const active = sort.key === option.key;
          const suffix = active && option.key !== "default" ? (sort.direction === "desc" ? " ↓" : " ↑") : "";
          return (
            <button
              key={option.key}
              type="button"
              class={active ? "active" : ""}
              onClick={() => onSort(option.key)}
            >
              {option.label}{suffix}
            </button>
          );
        })}
      </div>

      <div class="portfolio-table-wrap">
        <div class="portfolio-table position-table">
          <div class="portfolio-table-head">
            <span>标的</span><span>仓位</span><span>成本 / 现价</span><span>浮动盈亏</span><span>AI 建议</span><span>风险</span><span>操作</span>
          </div>
          {holdings.length ? holdings.map(row => (
            <PositionRow key={row.id} row={row} active={String(selectedKey || holdings[0]?.id) === String(row.id)} onSelect={onSelect} onDelete={deletePosition} />
          )) : <EmptyTable text="暂无持仓，先添加一个标的。" />}
        </div>
      </div>
    </>
  );
}

function CompactPositionForm({ form, busy, suggestions, quote, onSubmit, onSearch, onSelect, onChange }) {
  const derived = derivePositionNumbers(form, quote);
  const handleAmountInput = (value) => {
    onChange({ ...form, amount: value });
  };
  const handleMarketValueInput = (value) => {
    onChange({ ...form, marketValue: value });
  };
  const handleSharesInput = (value) => {
    onChange({ ...form, shares: value });
  };
  const handleCostInput = (value) => {
    onChange({ ...form, cost: value });
  };

  return (
    <form class="compact-form position-form" onSubmit={onSubmit}>
      <SearchField value={form.code} suggestions={suggestions} onInput={onSearch} onSelect={onSelect} />
      <button type="submit" disabled={busy || !form.code || derived.blocked}>{busy ? "新增中" : "新增"}</button>
      <div class="position-entry-grid">
        <div class={`position-entry-card ${derived.source === "amount-market" ? "active" : ""}`}>
          <div class="position-entry-title">
            <span>金额估算</span>
            <em>投入 + 市值</em>
          </div>
          <input type="number" step="0.01" placeholder="投入金额" value={form.amount} onInput={e => handleAmountInput(e.target.value)} />
          <input type="number" step="0.01" placeholder="当前市值" value={form.marketValue} onInput={e => handleMarketValueInput(e.target.value)} />
        </div>
        <div class={`position-entry-card ${derived.source === "detail" ? "active" : ""}`}>
          <div class="position-entry-title">
            <span>明细录入</span>
            <em>数量 + 成本</em>
          </div>
          <input type="number" placeholder="数量" value={form.shares} onInput={e => handleSharesInput(e.target.value)} />
          <input type="number" step="0.001" placeholder="成本价" value={form.cost} onInput={e => handleCostInput(e.target.value)} />
        </div>
      </div>
      <span class={`quote-hint ${derived.blocked ? "warn" : !quote && form.code ? "muted" : ""}`}>{positionEntryHint(form, quote, derived)}</span>
    </form>
  );
}

function normalizePositionPayload(form, quote) {
  const derived = derivePositionNumbers(form, quote);
  return {
    code: form.code,
    name: form.name || form.code,
    market: form.market,
    quoteSecid: form.quoteSecid || "",
    shares: derived.shares || 0,
    cost: derived.cost || 0
  };
}

function derivePositionNumbers(form, quote) {
  const amount = toPositiveNumber(form.amount);
  const marketValue = toPositiveNumber(form.marketValue);
  const shares = toPositiveNumber(form.shares);
  const cost = toPositiveNumber(form.cost);
  const price = toPositiveNumber(quote?.price);

  if (shares && cost) return { shares, cost, source: "detail" };
  if (amount && marketValue && price) {
    const estimatedShares = marketValue / price;
    return { shares: estimatedShares, cost: estimatedShares ? amount / estimatedShares : 0, source: "amount-market" };
  }
  if (amount && marketValue && !price) return { shares: 0, cost: 0, source: "amount-market", blocked: true };
  if (shares && amount) return { shares, cost: amount / shares, source: "mixed" };
  if (cost && amount) return { shares: amount / cost, cost, source: "mixed" };
  if (cost && marketValue && price) return { shares: marketValue / price, cost, source: "mixed" };
  if (shares) return { shares, cost: 0, source: "shares-only" };
  return { shares: 0, cost: 0, source: "empty" };
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function positionEntryHint(form, quote, derived) {
  if (!form.code) return "先搜索并选择标的";
  if (derived.blocked) return "金额估算需要先选中搜索结果，系统拿到现价后再计算";
  const selected = form.name ? `${form.name}（${form.code}）` : form.code;
  const quoteText = quote ? ` · ${formatQuoteHint(quote)}` : "";
  if (derived.shares && derived.cost) return `${selected}${quoteText} · 入库 ${formatNumber(derived.shares)} 股 / 成本 ${formatMoney(derived.cost, 3)}`;
  if (derived.shares) return `${selected}${quoteText} · 入库 ${formatNumber(derived.shares)} 股 / 成本未知`;
  return `${selected}${quoteText} · 可只建仓，稍后补数量和成本`;
}

function PositionRow({ row, active, onSelect, onDelete }) {
  return (
    <div class={`portfolio-row ${active ? "active" : ""}`} role="button" tabIndex="0" onClick={() => onSelect(row.id)} onKeyDown={e => { if (e.key === "Enter") onSelect(row.id); }}>
      <span class="security-cell">
        <strong>{row.name}</strong>
        <em>{row.code} · {row.market} · {formatNumber(row.shares)}股</em>
      </span>
      <span>{row.weight ? `${row.weight.toFixed(1)}%` : "-"}</span>
      <span>
        <strong>{row.hasCost ? formatMoney(row.cost, 3) : "成本未知"}</strong>
        <em>{row.price ? formatMoney(row.price, 3) : "无行情"}</em>
      </span>
      <span class={row.pnl == null ? "muted-text" : row.pnl >= 0 ? "money-up" : "money-down"}>
        <strong>{row.pnl == null ? "-" : formatSignedMoney(row.pnl)}</strong>
        <em>{row.pnl == null ? (row.hasCost ? "待更新" : "待补成本") : formatSignedPct(row.pnlPct)}</em>
      </span>
      <span><ActionChip text={row.reason} status={row.analysisStatus} /></span>
      <span><RiskBadge text={row.risk} status={row.analysisStatus} /></span>
      <span class="row-actions">
        <button type="button" onClick={e => { e.stopPropagation(); onSelect(row.id); }}>查看</button>
        <button type="button" class="danger" onClick={e => { e.stopPropagation(); onDelete(row.id, row.name); }}>删除</button>
      </span>
    </div>
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

function PortfolioAnalysisPanel({ analysis }) {
  if (!analysis.count) {
    return (
      <div class="portfolio-analysis">
        <div class="portfolio-analysis-empty">
          <strong>暂无可分析持仓</strong>
          <p>添加持仓后，会自动生成组合分布、收益归因和仓位健康度。</p>
        </div>
      </div>
    );
  }

  return (
    <div class="portfolio-analysis">
      <div class="portfolio-analysis-head">
        <div>
          <h2>组合分析</h2>
          <p>从仓位、盈亏、风险和主题暴露看清组合结构。</p>
        </div>
        <div class="analysis-quality-strip">
          <span>行情覆盖 {formatPercent(analysis.priceCoverage)}</span>
          <span>成本覆盖 {formatPercent(analysis.costCoverage)}</span>
          <span>主题识别 {formatPercent(analysis.themeCoverage)}</span>
        </div>
      </div>

      <div class="analysis-snapshot-grid">
        <SnapshotMetric label="总市值" value={formatMoney(analysis.totalMarket)} hint={`${analysis.count} 只持仓`} />
        <SnapshotMetric label="浮动盈亏" value={formatSignedMoney(analysis.pnl)} hint={formatSignedPct(analysis.pnlPct)} tone={analysis.pnl >= 0 ? "up" : "down"} />
        <SnapshotMetric label="最大单仓" value={formatPercent(analysis.maxWeight)} hint={analysis.largestHolding?.name || "暂无"} tone={analysis.maxWeight > 35 ? "warn" : ""} />
        <SnapshotMetric label="健康度" value={`${analysis.healthScore}`} hint={analysis.healthLabel} tone={analysis.healthTone} />
      </div>

      <div class="portfolio-analysis-grid two">
        <DistributionCard title="市场分布" subtitle="A股、科创成长、美股海外和固收方向" rows={analysis.marketRows} center={`${formatPercent(analysis.topMarketWeight, 0)}`} centerLabel="第一方向" />
        <DistributionCard title="资产类型" subtitle="ETF、指数基金、主动基金和股票仓位" rows={analysis.assetRows} center={`${formatPercent(analysis.topAssetWeight, 0)}`} centerLabel="第一类型" />
      </div>

      <div class="portfolio-analysis-grid two">
        <DistributionCard title="风险分布" subtitle="按 AI 风险标签汇总仓位" rows={analysis.riskRows} center={`${analysis.highRiskCount}`} centerLabel="高风险" />
        <AttributionPanel rows={analysis.pnlRows} />
      </div>

      <div class="portfolio-analysis-grid two">
        <HealthPanel analysis={analysis} />
        <ThemeExposurePanel analysis={analysis} compact />
      </div>
    </div>
  );
}

function SnapshotMetric({ label, value, hint, tone = "" }) {
  return (
    <div class={`analysis-snapshot ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function AnalysisCard({ title, subtitle, children }) {
  return (
    <section class="portfolio-analysis-card">
      <div class="analysis-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function DistributionCard({ title, subtitle, rows, center, centerLabel }) {
  return (
    <AnalysisCard title={title} subtitle={subtitle}>
      <div class="distribution-card-body">
        <DonutChart rows={rows} center={center} centerLabel={centerLabel} />
        <div class="analysis-legend">
          {rows.length ? rows.map((row, index) => (
            <div class="analysis-legend-row" key={row.label}>
              <i style={`background:${CHART_COLORS[index % CHART_COLORS.length]}`} />
              <span>{row.label}</span>
              <strong>{formatPercent(row.weight)}</strong>
              <em>{formatMoney(row.value)}</em>
            </div>
          )) : <div class="analysis-empty-line">暂无分布数据</div>}
        </div>
      </div>
    </AnalysisCard>
  );
}

function DonutChart({ rows, center, centerLabel }) {
  let cursor = 0;
  const segments = rows.length ? rows.map((row, index) => {
    const start = cursor;
    const end = Math.min(100, cursor + Math.max(0, row.weight || 0));
    cursor = end;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${end}%`;
  }) : ["#e7eef7 0% 100%"];
  if (cursor < 100) segments.push(`#eef3f8 ${cursor}% 100%`);

  return (
    <div class="portfolio-donut" style={`background: conic-gradient(${segments.join(",")});`}>
      <div>
        <strong>{center}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

function AttributionPanel({ rows }) {
  return (
    <AnalysisCard title="收益归因" subtitle="按持仓浮动盈亏贡献排序">
      <AnalysisBarList
        rows={rows}
        valueFormatter={(value, row) => `${formatSignedMoney(value)} · ${row.detail}`}
        emptyText="暂无可归因的盈亏数据"
      />
    </AnalysisCard>
  );
}

function HealthPanel({ analysis }) {
  return (
    <AnalysisCard title="仓位健康度" subtitle="集中度、数据覆盖和风险暴露">
      <div class="health-panel-body">
        <div class={`health-score ${analysis.healthTone}`}>
          <strong>{analysis.healthScore}</strong>
          <span>{analysis.healthLabel}</span>
        </div>
        <div class="health-factors">
          {analysis.healthFactors.map(item => (
            <div class="health-factor" key={item.label}>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div class="health-factor-track"><i style={`width:${item.percent}%`} /></div>
            </div>
          ))}
        </div>
      </div>
      <div class="health-alerts">
        {analysis.healthAlerts.map(item => <span class={item.tone} key={item.text}>{item.text}</span>)}
      </div>
    </AnalysisCard>
  );
}

function ThemeExposurePanel({ analysis, compact = false }) {
  return (
    <section class={`portfolio-analysis-card theme-exposure-card ${compact ? "compact" : ""}`}>
      <div class="analysis-card-head">
        <div>
          <h3>底层主题暴露</h3>
          <p>初版为规则估算，真实基金底仓穿透待接入。</p>
        </div>
        <span class="analysis-source-badge">识别覆盖 {formatPercent(analysis.themeCoverage)}</span>
      </div>
      <div class="theme-exposure-list">
        {analysis.themeRows.length ? analysis.themeRows.map((row, index) => (
          <div class="theme-exposure-row" key={row.label}>
            <div class="theme-exposure-main">
              <div class="theme-exposure-title">
                <i style={`background:${CHART_COLORS[index % CHART_COLORS.length]}`} />
                <span>{row.label}</span>
                <strong>{formatPercent(row.weight)}</strong>
              </div>
              <div class="theme-bar-track"><i style={`width:${Math.max(3, row.weight)}%`} /></div>
              <p>{row.contributors.slice(0, 4).map(item => item.name).join("、") || "待识别"}</p>
            </div>
            <strong class="theme-exposure-value">{formatMoney(row.value)}</strong>
          </div>
        )) : <div class="analysis-empty-line">暂无主题暴露数据</div>}
      </div>
    </section>
  );
}

function AnalysisBarList({ rows, valueFormatter, emptyText }) {
  const max = Math.max(1, ...rows.map(row => Math.abs(row.value || 0)));
  if (!rows.length) return <div class="analysis-empty-line">{emptyText}</div>;
  return (
    <div class="analysis-bar-list">
      {rows.map(row => {
        const tone = row.tone || (row.value >= 0 ? "up" : "down");
        const width = Math.max(4, Math.abs(row.value || 0) / max * 100);
        return (
          <div class={`analysis-bar-row ${tone}`} key={row.key || row.label}>
            <div class="analysis-bar-meta">
              <span>{row.label}</span>
              <strong>{valueFormatter(row.value, row)}</strong>
            </div>
            <div class="analysis-bar-track"><i style={`width:${width}%`} /></div>
          </div>
        );
      })}
    </div>
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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ shares: row.shares || "", cost: row.cost || "" });
  const animate = pendingAnimate.has(row.id) && row.analysisStatus === "done";
  if (animate) pendingAnimate.delete(row.id);
  const AnalysisComp = animate ? AnalysisContentAnimated : AnalysisContent;

  useEffect(() => {
    setEditing(false);
    setSaving(false);
    setForm({ shares: row.shares || "", cost: row.cost || "" });
  }, [row.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updatePosition(row.id, form);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside class="portfolio-detail">
      <DetailTitle title={row.name} meta={`${row.code} · ${row.market} · ${formatNumber(row.shares)}股`} />
      <div class="detail-metrics">
        <MiniMetric label="市值" value={formatMoney(row.marketValue)} />
        <MiniMetric label="成本" value={row.hasCost ? formatMoney(row.costValue) : "成本未知"} />
        <MiniMetric label="盈亏" value={row.pnl == null ? "待补充成本" : `${formatSignedMoney(row.pnl)} / ${formatSignedPct(row.pnlPct)}`} tone={row.pnl == null ? "" : row.pnl >= 0 ? "up" : "down"} />
      </div>
      {editing && (
        <form class="position-edit-form" onSubmit={handleSubmit}>
          <label>
            <span>数量</span>
            <input type="number" min="0" step="0.01" value={form.shares} onInput={e => setForm({ ...form, shares: e.target.value })} />
          </label>
          <label>
            <span>成本价</span>
            <input type="number" min="0" step="0.001" value={form.cost} onInput={e => setForm({ ...form, cost: e.target.value })} />
          </label>
          <div class="position-edit-actions">
            <button type="submit" class="primary-mini-button" disabled={saving}>{saving ? "保存中" : "保存并重新分析"}</button>
            <button type="button" class="ghost-button" onClick={() => setEditing(false)} disabled={saving}>取消</button>
          </div>
        </form>
      )}
      <div class="detail-chip-row">
        <ActionChip text={row.reason} status={row.analysisStatus} />
        <RiskBadge text={row.risk} status={row.analysisStatus} />
      </div>
      <AnalysisComp status={row.analysisStatus} fields={[
        { label: "理由", value: row.reason },
        { label: "风险", value: row.risk },
      ]} />
      <DetailActions>
        <button class="ghost-button" onClick={() => setEditing(true)}>编辑持仓</button>
        {row.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => reanalyzePosition(row.id)}>重新分析</button>}
        <button class="ghost-button danger" onClick={() => deletePosition(row.id, row.name)}>删除持仓</button>
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

async function updatePosition(id, form) {
  await put(`/api/positions/${encodeURIComponent(id)}`, {
    shares: Number(form.shares) || 0,
    cost: Number(form.cost) || 0
  });
  pendingAnimate.add(id);
  await loadPortfolio();
  showToast("已更新，重新分析中...");
}

async function deletePosition(id, name = "该持仓") {
  if (globalThis.confirm && !globalThis.confirm(`确认删除 ${name}？`)) return;
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

const CHART_COLORS = ["#2563eb", "#0f766e", "#dc2626", "#7c3aed", "#d97706", "#0891b2", "#64748b", "#be185d"];

function buildPortfolioAnalysis(holdings) {
  const totalMarket = holdings.reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const totalCost = holdings.reduce((sum, row) => sum + Number(row.costValue || 0), 0);
  const costedMarketValue = holdings.filter(row => row.hasCost).reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const pnl = costedMarketValue - totalCost;
  const pnlPct = totalCost ? (pnl / totalCost) * 100 : 0;
  const count = holdings.length;
  const sortedByValue = [...holdings].sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0));
  const largestHolding = sortedByValue[0] || null;
  const maxWeight = largestHolding?.weight || 0;
  const top5Weight = totalMarket ? sortedByValue.slice(0, 5).reduce((sum, row) => sum + Number(row.marketValue || 0), 0) / totalMarket * 100 : 0;
  const priceCoverage = count ? holdings.filter(row => row.hasPrice).length / count * 100 : 0;
  const costCoverage = count ? holdings.filter(row => row.hasCost).length / count * 100 : 0;
  const highRiskRows = holdings.filter(row => riskLevel(row.risk) === "high");
  const highRiskValue = highRiskRows.reduce((sum, row) => sum + Number(row.marketValue || 0), 0);
  const highRiskWeight = totalMarket ? highRiskValue / totalMarket * 100 : 0;
  const marketRows = groupHoldingRows(holdings, classifyMarketBucket, totalMarket);
  const assetRows = groupHoldingRows(holdings, classifyAssetBucket, totalMarket);
  const riskRows = groupHoldingRows(holdings, riskBucket, totalMarket);
  const themeRows = buildThemeRows(holdings, totalMarket);
  const themeKnownValue = themeRows.filter(row => row.label !== "其他/待穿透").reduce((sum, row) => sum + row.value, 0);
  const themeCoverage = totalMarket ? themeKnownValue / totalMarket * 100 : 0;
  const health = buildPortfolioHealth({ maxWeight, top5Weight, highRiskWeight, priceCoverage, costCoverage, themeCoverage });

  return {
    count,
    totalMarket,
    totalCost,
    pnl,
    pnlPct,
    largestHolding,
    maxWeight,
    top5Weight,
    topMarketWeight: marketRows[0]?.weight || 0,
    highRiskCount: highRiskRows.length,
    highRiskWeight,
    priceCoverage,
    costCoverage,
    themeCoverage,
    marketRows,
    assetRows,
    riskRows,
    themeRows,
    topAssetWeight: assetRows[0]?.weight || 0,
    pnlRows: buildAttributionRows(holdings),
    ...health
  };
}

function groupHoldingRows(holdings, getLabel, totalMarket) {
  const map = new Map();
  holdings.forEach(row => {
    const label = getLabel(row);
    const current = map.get(label) || { label, value: 0, count: 0 };
    current.value += Number(row.marketValue || 0);
    current.count += 1;
    map.set(label, current);
  });
  return Array.from(map.values())
    .map(row => ({ ...row, weight: totalMarket ? row.value / totalMarket * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function classifyMarketBucket(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  if (/债|货币|现金|增利|短债|纯债/.test(text)) return "固收/现金";
  if (/港股|恒生|香港|h股/.test(text)) return "港股";
  if (/美股|纳斯达克|标普|sp500|s&p|qdii|全球|海外|美元/.test(text)) return "美股/海外";
  if (/科创|半导体|芯片|集成电路|创业/.test(text)) return "A股科创成长";
  if (/中证|沪深|上证|深证|创业板|a股|etf|基金/.test(text)) return "A股宽基/基金";
  return row.market || "其他";
}

function classifyAssetBucket(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  if (/债|货币|现金|增利|短债|纯债/.test(text)) return "固收基金";
  if (/qdii|全球|海外|纳斯达克|标普/.test(text)) return "QDII / 海外基金";
  if (/etf|联接|指数|中证|沪深|上证|深证|创业板|科创/.test(text)) return "指数 / ETF";
  if (/基金|混合|股票型/.test(text)) return "主动基金";
  if (/a股|港股|美股|股票/.test(text)) return "股票";
  return row.market || "其他";
}

function riskBucket(row) {
  const level = riskLevel(row.risk);
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function buildAttributionRows(holdings) {
  return holdings
    .filter(row => row.pnl != null)
    .sort((a, b) => Math.abs(Number(b.pnl || 0)) - Math.abs(Number(a.pnl || 0)))
    .slice(0, 6)
    .map(row => ({
      key: row.id || row.code,
      label: row.name,
      value: Number(row.pnl || 0),
      detail: formatSignedPct(row.pnlPct),
      tone: Number(row.pnl || 0) >= 0 ? "up" : "down"
    }));
}

function buildThemeRows(holdings, totalMarket) {
  const map = new Map();
  holdings.forEach(row => {
    const themes = inferThemes(row);
    const totalWeight = themes.reduce((sum, item) => sum + item.weight, 0) || 1;
    themes.forEach(theme => {
      const value = Number(row.marketValue || 0) * theme.weight / totalWeight;
      const current = map.get(theme.label) || { label: theme.label, value: 0, contributors: [] };
      current.value += value;
      current.contributors.push({ name: row.name, value });
      map.set(theme.label, current);
    });
  });

  return Array.from(map.values())
    .map(row => ({
      ...row,
      contributors: row.contributors.sort((a, b) => b.value - a.value),
      weight: totalMarket ? row.value / totalMarket * 100 : 0
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

function inferThemes(row) {
  const text = `${row.name || ""} ${row.code || ""} ${row.market || ""}`.toLowerCase();
  const themes = [];
  const add = (label, weight) => themes.push({ label, weight });

  if (/光模块|光通信|cpo|光器件/.test(text)) add("光模块/CPO", 1);
  if (/dram|hbm|内存/.test(text)) add("DRAM/HBM", 1);
  if (/nand|存储|闪存/.test(text)) add("NAND/存储", 1);
  if (/半导体|芯片|集成电路/.test(text)) {
    add("芯片/半导体", 0.58);
    add("AI 算力/科技", 0.18);
    add("DRAM/HBM", 0.08);
    add("NAND/存储", 0.06);
    add("科创成长", 0.1);
  }
  if (/科创|创业/.test(text)) {
    add("科创成长", 0.46);
    add("芯片/半导体", 0.24);
    add("AI 算力/科技", 0.18);
    add("高端制造", 0.12);
  }
  if (/纳斯达克|nasdaq|全球科技|科技先锋/.test(text)) {
    add("美股科技", 0.48);
    add("AI 算力/科技", 0.27);
    add("芯片/半导体", 0.14);
    add("海外资产", 0.11);
  }
  if (/标普|sp500|s&p/.test(text)) {
    add("美股宽基", 0.7);
    add("海外资产", 0.2);
    add("AI 算力/科技", 0.1);
  }
  if (/中证500|500指数/.test(text)) add("A股中盘宽基", 1);
  if (/上证50|沪深300|中证1000|全a|a500|深证100/.test(text)) add("A股宽基", 1);
  if (/债|货币|现金|增利|短债|纯债/.test(text)) add("固收/现金", 1);
  if (/医药|医疗|创新药/.test(text)) add("医药医疗", 1);
  if (/消费|白酒|食品/.test(text)) add("消费", 1);

  return themes.length ? themes : [{ label: "其他/待穿透", weight: 1 }];
}

function buildPortfolioHealth({ maxWeight, top5Weight, highRiskWeight, priceCoverage, costCoverage, themeCoverage }) {
  let score = 100;
  if (maxWeight > 35) score -= Math.min(22, (maxWeight - 35) * 0.8);
  if (top5Weight > 80) score -= Math.min(18, (top5Weight - 80) * 0.8);
  if (highRiskWeight > 35) score -= Math.min(20, (highRiskWeight - 35) * 0.7);
  if (priceCoverage < 90) score -= Math.min(18, (90 - priceCoverage) * 0.5);
  if (costCoverage < 90) score -= Math.min(14, (90 - costCoverage) * 0.35);
  if (themeCoverage < 55) score -= Math.min(12, (55 - themeCoverage) * 0.25);
  const healthScore = Math.max(0, Math.round(score));
  const healthTone = healthScore >= 80 ? "good" : healthScore >= 60 ? "warn" : "bad";
  const healthLabel = healthScore >= 80 ? "结构稳健" : healthScore >= 60 ? "需要复核" : "风险偏高";
  const healthAlerts = [];

  if (maxWeight > 35) healthAlerts.push({ text: `最大单仓 ${formatPercent(maxWeight)}，集中度偏高`, tone: "warn" });
  if (top5Weight > 80) healthAlerts.push({ text: `前五持仓 ${formatPercent(top5Weight)}，组合分散度不足`, tone: "warn" });
  if (highRiskWeight > 35) healthAlerts.push({ text: `高风险仓位 ${formatPercent(highRiskWeight)}，需复核止损线`, tone: "bad" });
  if (priceCoverage < 90) healthAlerts.push({ text: `行情覆盖 ${formatPercent(priceCoverage)}，部分市值待更新`, tone: "warn" });
  if (costCoverage < 90) healthAlerts.push({ text: `成本覆盖 ${formatPercent(costCoverage)}，收益归因不完整`, tone: "warn" });
  if (themeCoverage < 55) healthAlerts.push({ text: `主题识别 ${formatPercent(themeCoverage)}，底仓穿透待增强`, tone: "muted" });
  if (!healthAlerts.length) healthAlerts.push({ text: "仓位、风险和数据覆盖暂无明显异常", tone: "good" });

  return {
    healthScore,
    healthTone,
    healthLabel,
    healthAlerts,
    healthFactors: [
      { label: "最大单仓", value: formatPercent(maxWeight), percent: Math.min(100, maxWeight) },
      { label: "前五集中", value: formatPercent(top5Weight), percent: Math.min(100, top5Weight) },
      { label: "高风险仓位", value: formatPercent(highRiskWeight), percent: Math.min(100, highRiskWeight) },
      { label: "数据覆盖", value: formatPercent(Math.min(priceCoverage, costCoverage)), percent: Math.min(priceCoverage, costCoverage) },
    ]
  };
}

function buildHoldings(items, prices) {
  const rows = items.map(p => {
    const quote = prices[p.code];
    const price = typeof quote === "number" ? quote : quote?.price;
    const shares = Number(p.shares || 0);
    const cost = Number(p.cost || 0);
    const hasCost = cost > 0;
    const hasPrice = Number(price || 0) > 0;
    const costValue = hasCost ? shares * cost : 0;
    const marketValue = shares * Number(price || (hasCost ? cost : 0));
    const pnl = hasCost && hasPrice ? marketValue - costValue : null;
    const pnlPct = pnl == null || !costValue ? null : (pnl / costValue) * 100;
    return { ...p, shares, cost, hasCost, hasPrice, market: quote?.market || p.market, price, quoteSource: quote?.sourceLabel, costValue, marketValue, pnl, pnlPct };
  });
  const totalMarket = rows.reduce((sum, row) => sum + row.marketValue, 0);
  return rows.map(row => ({ ...row, weight: totalMarket ? (row.marketValue / totalMarket) * 100 : 0 }));
}

function sortHoldings(rows, sort) {
  if (!sort || sort.key === "default") return rows;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortableHoldingValue(a, sort.key);
    const bv = sortableHoldingValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * direction;
  });
}

function sortableHoldingValue(row, key) {
  if (key === "marketValue") return Number(row.marketValue || 0);
  if (key === "pnlPct") return row.pnlPct == null ? null : Number(row.pnlPct);
  return null;
}

function getOverview(holdings, stockRows, etfs) {
  const cost = holdings.reduce((sum, row) => sum + row.costValue, 0);
  const marketValue = holdings.reduce((sum, row) => sum + row.marketValue, 0);
  const costedMarketValue = holdings.filter(row => row.hasCost).reduce((sum, row) => sum + row.marketValue, 0);
  const pnl = costedMarketValue - cost;
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
  if (activeTab === "analysis") return null;
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

function formatPercent(value, digits = 1) {
  const n = Number(value || 0);
  return `${n.toFixed(digits)}%`;
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
