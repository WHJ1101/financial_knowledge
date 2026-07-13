import { useRef, useState } from "preact/hooks";

import { get, post } from "../../api.js";
import { loadPortfolio, loadPortfolioHistory, portfolioHistory, showToast } from "../../store.js";
import { derivePositionNumbers, normalizePositionPayload, positionEntryHint } from "../../lib/position-math.js";
import { formatMoney, formatNumber, formatSignedMoney, formatSignedPct } from "../../lib/format.js";
import { ActionChip, EmptyTable, PanelHeader, RiskBadge, SearchField } from "./PortfolioShared.jsx";
import { deletePosition, pendingAnimate } from "./PortfolioActions.js";

const POSITION_SORT_OPTIONS = [
  { key: "default", label: "默认" },
  { key: "marketValue", label: "市值" },
  { key: "pnlPct", label: "收益率" }
];

export function PositionPanel({ holdings, selectedKey, sort, onSort, onSelect }) {
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
      loadPortfolioHistory(portfolioHistory.value.range); // 新增持仓后按当前范围刷新曲线（§5.3）
      onSelect(created.id || form.code);
      showToast("已添加，AI 分析中...");
    } catch (err) {
      showToast(`添加失败：${err.message}`);
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
        <em>{row.price ? formatMoney(row.price, 3) + " · " + (row.quoteSource || "行情") : "无行情"}</em>
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
