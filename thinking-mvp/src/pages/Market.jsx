import { indices, marketSnapshot } from "../store.js";

export function Market() {
  const snap = marketSnapshot.value;

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>行情</h1>
        <p class="page-description">主要市场指数实时数据（交易时间内 30 秒刷新）与关联 ETF 映射。</p>
        {snap.updatedAt && <p class="time-row">最近更新：{new Date(snap.updatedAt).toLocaleTimeString("zh-CN")}</p>}
      </div>
      <section class="board route-panel">
        <div class="route-card-grid">
          {indices.value.map(i => (
            <article key={i.code} class="route-card market-card">
              <div class="market-card-head">
                <span class="mini-label">{i.region}</span>
                <h2>{i.name}</h2>
              </div>
              <div class="market-card-body">
                <span class="market-level-big">{i.level || "--"}</span>
                <span class={`market-change-big ${Number(i.changePct) >= 0 ? "up" : "down"}`}>
                  {i.changePct && i.changePct !== "待接入" ? `${i.changePct}%` : "--"}
                </span>
              </div>
              {i.relatedEtfs?.length > 0 && (
                <p class="market-etfs"><b>关联基金：</b>{i.relatedEtfs.join("、")}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
