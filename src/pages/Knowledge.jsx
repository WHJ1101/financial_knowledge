import { query, reports } from "../store.js";
import { ReportList } from "../components/ReportList.jsx";
import { buildKnowledgeHash, parseKnowledgeFilters } from "../lib/hash-route.js";

const TOPICS = ["产业链深度", "政策扫描", "市场快览", "个股跟踪", "主题调研"];

export function Knowledge({ route = location.hash || "#knowledge" }) {
  const filters = parseKnowledgeFilters(route);
  const { q, filter, origin, topic } = filters;

  let visible = reportsByFilter(filter);
  if (origin !== "all") visible = visible.filter(r => r.origin === origin);
  if (topic !== "all") visible = visible.filter(r => r.typeLabel === topic);

  const updateFilters = (patch) => {
    location.hash = buildKnowledgeHash({ ...filters, ...patch });
  };

  const clearSearch = () => {
    query.value = "";
    location.hash = buildKnowledgeHash({ ...filters, q: "" });
  };

  const resetFilters = () => {
    location.hash = buildKnowledgeHash({ q });
  };

  const hasScopedFilters = filter !== "all" || origin !== "all" || topic !== "all";

  return (
    <div class="nav-page">
      <div class="page-head">
        <div>
          <h1>知识库</h1>
          <p class="page-description">浏览、搜索、筛选所有研究报告。</p>
        </div>
        <div class="portfolio-head-actions">
          <a class="ghost-button" href="/api/export/reports.csv">导出 CSV</a>
          <a class="ghost-button" href="/api/export/reports.json">导出 JSON</a>
        </div>
      </div>
      <section class="board">
        <div class="board-head knowledge-board-head">
          <div class="board-filters">
            {["all", "starred", "archived"].map(f => (
              <button key={f} class={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => updateFilters({ filter: f })}>
                {f === "all" ? "全部" : f === "starred" ? "★ 标星" : "归档"}
              </button>
            ))}
          </div>
          <div class="knowledge-filter-controls">
            <select class="origin-select" onChange={e => updateFilters({ topic: e.target.value })} value={topic}>
              <option value="all">全部主题</option>
              {TOPICS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <select class="origin-select" onChange={e => updateFilters({ origin: e.target.value })} value={origin}>
              <option value="all">全部来源</option>
              <option value="automation">自动化</option>
              <option value="manual">手动</option>
            </select>
          </div>
        </div>
        {(q || hasScopedFilters) && (
          <div class="knowledge-filter-summary">
            <span>{q ? `搜索：${q}` : "当前筛选"}</span>
            {hasScopedFilters && <em>{describeFilters({ filter, origin, topic })}</em>}
            {q && <button type="button" class="ghost-button" onClick={clearSearch}>清空搜索</button>}
            {hasScopedFilters && <button type="button" class="ghost-button" onClick={resetFilters}>重置筛选</button>}
          </div>
        )}
        <div class="report-sections">
          <ReportList reports={visible} emptyText={q ? "没有找到匹配报告" : "暂无匹配报告"} />
        </div>
      </section>
    </div>
  );
}

function reportsByFilter(filter) {
  if (filter === "starred") return reports.value.filter(r => r.starred && !r.archived);
  if (filter === "archived") return reports.value.filter(r => r.archived);
  return reports.value.filter(r => !r.archived);
}

function describeFilters({ filter, origin, topic }) {
  return [
    filter === "starred" ? "标星" : filter === "archived" ? "归档" : "",
    origin === "automation" ? "自动化" : origin === "manual" ? "手动" : "",
    topic !== "all" ? topic : ""
  ].filter(Boolean).join(" · ");
}
