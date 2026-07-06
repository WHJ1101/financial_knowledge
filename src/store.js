import { signal } from "@preact/signals";
import { get } from "./api.js";
import { getHashPage } from "./lib/hash-route.js";

export const status = signal(null);
export const reports = signal([]);
export const stocks = signal([]);
export const positions = signal([]);
export const indices = signal([]);
export const marketSnapshot = signal({ indices: [], updatedAt: null });
export const decisions = signal([]);
export const signals = signal([]);
export const tasks = signal([]);
export const logs = signal([]);
export const query = signal("");
export const toast = signal("");


export async function loadRouteData(route) {
  const page = getHashPage(route);
  if (page.startsWith("#report/")) return;
  if (page === "#knowledge") return loadKnowledgeData();
  if (page === "#signals") return loadSignalsData();
  if (page === "#portfolio") return loadPortfolioData();
  if (page === "#decisions") return loadDecisionsData();
  if (page === "#tasks") return loadTasksData();
  if (page === "#settings") return loadSettingsData();
  return loadTodayData();
}

export async function loadShellData() {
  await Promise.allSettled([loadStatus(), loadMarket()]);
}

export async function loadTodayData() {
  await Promise.allSettled([loadStatus(), loadReports(), loadMarket()]);
}

export async function loadKnowledgeData() {
  await loadReports();
}

export async function loadPortfolioData() {
  await Promise.allSettled([loadPortfolio(), loadMarket()]);
}

export async function loadSignalsData() {
  await Promise.allSettled([loadStatus(), loadSignals()]);
}

export async function loadDecisionsData() {
  await Promise.allSettled([loadStatus(), loadDecisions()]);
}

export async function loadTasksData() {
  await Promise.allSettled([loadStatus(), loadTasks(), loadLogs()]);
}

export async function loadSettingsData() {
  await loadStatus();
}

export async function loadStatus() {
  try {
    status.value = await get("/api/status");
  } catch (err) {
    showToast("状态加载失败：" + err.message);
    throw err;
  }
}

export async function loadReports() {
  const params = new URLSearchParams();
  if (query.value) params.set("q", query.value);
  const q = params.toString() ? "?" + params : "";
  try {
    const data = await get("/api/reports" + q);
    reports.value = data.reports;
  } catch (err) {
    showToast("报告加载失败：" + err.message);
    throw err;
  }
}

export async function loadPortfolio() {
  try {
    const [s, p] = await Promise.all([get("/api/stocks"), get("/api/positions")]);
    stocks.value = s.stocks;
    positions.value = p.positions;
  } catch (err) {
    showToast("持仓加载失败：" + err.message);
    throw err;
  }
}

export async function loadDecisions() {
  try {
    const data = await get("/api/decisions");
    decisions.value = data.decisions;
  } catch (err) {
    showToast("决策加载失败：" + err.message);
    throw err;
  }
}

export async function loadSignals() {
  try {
    const data = await get("/api/signals?limit=100");
    signals.value = data.signals;
  } catch (err) {
    showToast("信号加载失败：" + err.message);
    throw err;
  }
}

export async function loadTasks() {
  try {
    const data = await get("/api/automation/tasks");
    tasks.value = data.tasks;
  } catch (err) {
    showToast("任务加载失败：" + err.message);
    throw err;
  }
}

export async function loadLogs() {
  try {
    const data = await get("/api/logs");
    logs.value = data.logs;
  } catch (err) {
    showToast("日志加载失败：" + err.message);
    throw err;
  }
}

export async function loadMarket() {
  try {
    const [snap, idx] = await Promise.all([
      get("/api/market/snapshot"), get("/api/market/indices")
    ]);
    marketSnapshot.value = snap;
    indices.value = idx.indices;
  } catch (err) {
    // 行情为后台轮询，失败静默保留旧值，不打断用户操作。
  }
}

export function showToast(msg) {
  toast.value = msg;
  setTimeout(() => { toast.value = ""; }, 2600);
}
