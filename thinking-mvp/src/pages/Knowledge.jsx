import { useState } from "preact/hooks";
import { reports } from "../store.js";
import { ReportList } from "../components/ReportList.jsx";

export function Knowledge() {
  const [filter, setFilter] = useState("all"); // all | starred | archived
  const [origin, setOrigin] = useState("all"); // all | automation | manual
  const [topic, setTopic] = useState("all");

  let visible = reports.value;
  if (filter === "starred") visible = visible.filter(r => r.starred);
  if (filter === "archived") visible = visible.filter(r => r.archived);
  if (filter === "all") visible = visible.filter(r => !r.archived);
  if (origin !== "all") visible = visible.filter(r => r.origin === origin);
  if (topic !== "all") visible = visible.filter(r => r.typeLabel === topic);

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
              <button key={f} class={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "全部" : f === "starred" ? "★ 标星" : "归档"}
              </button>
            ))}
          </div>
          <select class="origin-select" onChange={e => setTopic(e.target.value)} value={topic}>
            <option value="all">全部主题</option>
            <option value="产业链深度">产业链深度</option>
            <option value="政策扫描">政策扫描</option>
            <option value="市场快览">市场快览</option>
            <option value="个股跟踪">个股跟踪</option>
            <option value="主题调研">主题调研</option>
          </select>
          <select class="origin-select" onChange={e => setOrigin(e.target.value)} value={origin}>
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
