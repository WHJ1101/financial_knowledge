import { useEffect, useState } from "preact/hooks";

import { del, post } from "../../api.js";
import { RelatedReports } from "../../components/RelatedReports.jsx";
import { showToast } from "../../store.js";
import { confirmDanger } from "../../lib/confirm.js";
import { formatMoney, formatNumber, formatSignedMoney, formatSignedPct } from "../../lib/format.js";
import { statusText } from "../../lib/portfolio-analysis.js";
import {
  ActionChip, AnalysisContent, AnalysisContentAnimated, DetailActions,
  DetailTitle, MiniMetric, RiskBadge, StatusPill
} from "./PortfolioShared.jsx";
import {
  deletePosition, deleteStock, pendingAnimate,
  reanalyzePosition, reanalyzeStock, updatePosition
} from "./PortfolioActions.js";

export function DetailPanel({ activeTab, selected, onQuoteChange }) {
  if (!selected) {
    return (
      <aside class="portfolio-detail">
        <div class="detail-empty">选择一行查看分析详情。</div>
      </aside>
    );
  }
  if (activeTab === "positions") return <PositionDetail row={selected} onQuoteChange={onQuoteChange} />;
  if (activeTab === "stocks") return <StockDetail row={selected} />;
  return <EtfDetail row={selected} />;
}

function PositionDetail({ row, onQuoteChange }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ shares: row.shares || "", cost: row.cost || "" });
  const [quoteForm, setQuoteForm] = useState({ price: row.price || "", changePct: "", note: "" });
  const [savingQuote, setSavingQuote] = useState(false);
  const animate = pendingAnimate.has(row.id) && row.analysisStatus === "done";
  if (animate) pendingAnimate.delete(row.id);
  const AnalysisComp = animate ? AnalysisContentAnimated : AnalysisContent;

  useEffect(() => {
    setEditing(false);
    setSaving(false);
    setForm({ shares: row.shares || "", cost: row.cost || "" });
    setQuoteForm({ price: row.price || "", changePct: "", note: "" });
  }, [row.id, row.price]);

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

  const handleQuoteSubmit = async (e) => {
    e.preventDefault();
    setSavingQuote(true);
    try {
      await post("/api/quote-overrides", {
        code: row.code,
        name: row.name,
        market: row.market,
        price: quoteForm.price,
        changePct: quoteForm.changePct,
        note: quoteForm.note
      });
      if (onQuoteChange) onQuoteChange();
      showToast("手动行情已保存");
    } catch (err) {
      showToast("保存行情失败：" + err.message);
    } finally {
      setSavingQuote(false);
    }
  };

  const handleQuoteDelete = async () => {
    if (!confirmDanger("确认清除「" + row.name + "」的手动行情？")) return;
    try {
      await del("/api/quote-overrides/" + encodeURIComponent(row.code));
      if (onQuoteChange) onQuoteChange();
      showToast("手动行情已清除");
    } catch (err) {
      showToast("清除行情失败：" + err.message);
    }
  };

  return (
    <aside class="portfolio-detail">
      <DetailTitle title={row.name} meta={`${row.code} · ${row.market} · ${formatNumber(row.shares)}股`} />
      <div class="detail-metrics">
        <MiniMetric label="市值" value={formatMoney(row.marketValue)} />
        <MiniMetric label={row.quoteSource || "现价"} value={row.price ? formatMoney(row.price, 3) : "无行情"} />
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
      <form class="position-edit-form quote-override-form" onSubmit={handleQuoteSubmit}>
        <label>
          <span>手动现价</span>
          <input type="number" min="0" step="0.0001" value={quoteForm.price} onInput={e => setQuoteForm({ ...quoteForm, price: e.target.value })} />
        </label>
        <label>
          <span>涨跌幅</span>
          <input type="number" step="0.01" placeholder="可选" value={quoteForm.changePct} onInput={e => setQuoteForm({ ...quoteForm, changePct: e.target.value })} />
        </label>
        <label>
          <span>备注</span>
          <input value={quoteForm.note} onInput={e => setQuoteForm({ ...quoteForm, note: e.target.value })} />
        </label>
        <div class="position-edit-actions">
          <button type="submit" class="primary-mini-button" disabled={savingQuote || !quoteForm.price}>{savingQuote ? "保存中" : "保存手动行情"}</button>
          {row.quoteSource === "手动行情" && <button type="button" class="ghost-button" onClick={handleQuoteDelete} disabled={savingQuote}>清除</button>}
        </div>
      </form>
      <div class="detail-chip-row">
        <ActionChip text={row.reason} status={row.analysisStatus} />
        <RiskBadge text={row.risk} status={row.analysisStatus} />
      </div>
      <AnalysisComp status={row.analysisStatus} fields={[
        { label: "理由", value: row.reason },
        { label: "风险", value: row.risk },
      ]} />
      <RelatedReports code={row.code} />
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
      <RelatedReports code={row.code} />
      <DetailActions>
        {row.analysisStatus !== "analyzing" && <button class="ghost-button" onClick={() => reanalyzeStock(row.code)}>重新分析</button>}
        <button class="ghost-button danger" onClick={() => deleteStock(row.code, row.name)}>删除自选</button>
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
