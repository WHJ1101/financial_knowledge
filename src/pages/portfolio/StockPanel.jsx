import { useRef, useState } from "preact/hooks";

import { get, post } from "../../api.js";
import { loadPortfolio, showToast, stocks } from "../../store.js";
import { formatDate, formatQuoteHint } from "../../lib/format.js";
import { ActionChip, EmptyTable, PanelHeader, RiskBadge, SearchField, StatusPill } from "./PortfolioShared.jsx";
import { pendingAnimate } from "./PortfolioActions.js";

export function StockPanel({ selectedKey, onSelect }) {
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
    } catch (err) {
      showToast(`添加失败：${err.message}`);
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
