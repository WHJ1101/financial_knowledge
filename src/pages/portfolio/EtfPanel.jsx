import { EmptyTable, PanelHeader } from "./PortfolioShared.jsx";

export function EtfPanel({ etfs, selectedKey, onSelect }) {
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
