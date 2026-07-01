import { status } from "../store.js";

export function Settings() {
  const s = status.value?.settings || {};
  return (
    <div class="nav-page">
      <div class="page-head">
        <h1>设置</h1>
        <p class="page-description">本地服务配置和系统状态。</p>
      </div>
      <section class="board route-panel">
        <div class="board-head"><div><h2>系统配置</h2></div></div>
        <div class="route-list">
          <div class="route-list-item"><span>日更计划</span><strong>{s.scheduleLabel || s.schedule?.replace("Asia/Shanghai", "中国标准时间") || "未设置"}</strong></div>
          <div class="route-list-item"><span>上次日更</span><strong>{s.lastDailyRun || "未执行"}</strong></div>
          <div class="route-list-item"><span>自动化状态</span><strong>{s.automationEnabled ? "运行中" : "暂停"}</strong></div>
          <div class="route-list-item"><span>报告总数</span><strong>{status.value?.reportCount ?? "--"}</strong></div>
          <div class="route-list-item"><span>数据存储</span><strong>SQLite (data/app.db)</strong></div>
        </div>
      </section>
      <section class="board route-panel">
        <div class="board-head"><div><h2>数据源配置</h2><p>通过环境变量配置。</p></div></div>
        <div class="route-list">
          <div class="route-list-item"><span>LLM 接口</span><strong>{import.meta.env.VITE_LLM_API_URL || "未配置（使用证据草稿模式）"}</strong></div>
          <div class="route-list-item"><span>本地数据源</span><strong>data/sources/*.json</strong></div>
          <div class="route-list-item"><span>行情数据</span><strong>东方财富延迟行情（免费）</strong></div>
        </div>
      </section>
    </div>
  );
}
