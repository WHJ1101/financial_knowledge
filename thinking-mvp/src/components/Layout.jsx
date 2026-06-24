import { Sidebar } from "./Sidebar.jsx";
import { Toast } from "./Toast.jsx";
import { status, query, loadReports, refresh, showToast } from "../store.js";
import { post } from "../api.js";

export function Layout({ route, children }) {
  const s = status.value;

  const handleSearch = (e) => {
    query.value = e.target.value.trim();
    loadReports();
  };

  const toggleAutomation = async () => {
    const next = !s?.settings?.automationEnabled;
    await post("/api/automation/toggle", { enabled: next });
    await refresh();
    showToast(next ? "自动日更已开启" : "自动日更已暂停");
  };

  return (
    <div class="app-shell">
      <Sidebar route={route} />
      <main class="main">
        <header class="topbar">
          <label class="search-box">
            <span>⌕</span>
            <input type="search" placeholder="搜索报告、标的..." onInput={handleSearch} autocomplete="off" />
          </label>
          <div class="top-actions">
            <button class={`status-pill ${s?.settings?.automationEnabled ? "ok" : ""}`} onClick={toggleAutomation}>
              {s?.settings?.automationEnabled ? "⚡ 自动化运行中" : "自动化暂停"}
            </button>
          </div>
        </header>
        <section class="view">{children}</section>
      </main>
      <Toast />
    </div>
  );
}
