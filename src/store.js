import { signal } from "@preact/signals";
import { get } from "./api.js";

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

export async function refresh() {
  await Promise.allSettled([loadStatus(), loadReports(), loadBusiness(), loadMarket()]);
}

export async function loadStatus() {
  try {
    status.value = await get("/api/status");
  } catch (err) {
    showToast(`状态加载失败：${err.message}`);
    throw err;
  }
}

export async function loadReports() {
  const params = new URLSearchParams();
  if (query.value) params.set("q", query.value);
  const q = params.toString() ? `?${params}` : "";
  try {
    const data = await get(`/api/reports${q}`);
    reports.value = data.reports;
  } catch (err) {
    showToast(`报告加载失败：${err.message}`);
    throw err;
  }
}

export async function loadBusiness() {
  try {
    const [s, p, d, sig, t, l] = await Promise.all([
      get("/api/stocks"), get("/api/positions"),
      get("/api/decisions"), get("/api/signals?limit=100"), get("/api/automation/tasks"), get("/api/logs")
    ]);
    stocks.value = s.stocks;
    positions.value = p.positions;
    decisions.value = d.decisions;
    signals.value = sig.signals;
    tasks.value = t.tasks;
    logs.value = l.logs;
  } catch (err) {
    showToast(`业务数据加载失败：${err.message}`);
    throw err;
  }
}

export async function loadSignals() {
  try {
    const data = await get("/api/signals?limit=100");
    signals.value = data.signals;
  } catch (err) {
    showToast(`信号加载失败：${err.message}`);
    throw err;
  }
}

export async function loadPortfolio() {
  try {
    const [s, p] = await Promise.all([get("/api/stocks"), get("/api/positions")]);
    stocks.value = s.stocks;
    positions.value = p.positions;
  } catch (err) {
    showToast(`持仓加载失败：${err.message}`);
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
