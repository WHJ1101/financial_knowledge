import { useState } from "preact/hooks";
import { reports, originFilter, loadReports } from "../store.js";
import { ReportList } from "../components/ReportList.jsx";

export function Knowledge() {
  const [filter, setFilter] = useState("all"); // all | starred | archived

  const handleOrigin = (e) => { originFilter.value = e.target.value; loadReports(); };
  const handleFilter = (v) => { setFilter(v); };

  let visible = reports.value;
  if (filter === "starred") visible = visible.filter(r => r.starred);
  if (filter === "archived") visible = visible.filter(r => r.archived);
  if (filter === "all") visible = visible.filter(r => !r.archived);

  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>知识库</h1>
        <p class="page-description">浏览、搜索、筛选所有研究报告。</p>
      </div>
      <section class="board">
        <div class="board-head">
          <div class="board-filters">
            {["all", "starred", "archived"].map(f => (
              <button key={f} class={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => handleFilter(f)}>
                {f === "all" ? "全部" : f === "starred" ? "★ 标星" : "归档"}
              </button>
            ))}
          </div>
          <select class="origin-select" onChange={handleOrigin} value={originFilter.value}>
            <option value="all">全部来源</option>
            <option value="automation">自动化</option>
            <option value="manual">手动</option>
          </select>
        </div>
        <div class="report-sections">
          <ReportList reports={visible} emptyText="暂无匹配报告" />
        </div>
      </section>
    </div>
  );
}
