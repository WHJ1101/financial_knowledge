import { signal, effect } from "@preact/signals";
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
  await Promise.all([loadStatus(), loadReports(), loadBusiness(), loadMarket()]);
}

export async function loadStatus() {
  status.value = await get("/api/status");
}

export async function loadReports() {
  const params = new URLSearchParams();
  if (query.value) params.set("q", query.value);
  const q = params.toString() ? `?${params}` : "";
  const data = await get(`/api/reports${q}`);
  reports.value = data.reports;
}

export async function loadBusiness() {
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
}

export async function loadSignals() {
  const data = await get("/api/signals?limit=100");
  signals.value = data.signals;
}

export async function loadPortfolio() {
  const [s, p] = await Promise.all([get("/api/stocks"), get("/api/positions")]);
  stocks.value = s.stocks;
  positions.value = p.positions;
}

export async function loadMarket() {
  const [snap, idx] = await Promise.all([
    get("/api/market/snapshot"), get("/api/market/indices")
  ]);
  marketSnapshot.value = snap;
  indices.value = idx.indices;
}

export function showToast(msg) {
  toast.value = msg;
  setTimeout(() => { toast.value = ""; }, 2600);
}
