import { useEffect, useState } from "preact/hooks";
import { Sidebar } from "./Sidebar.jsx";
import { Toast } from "./Toast.jsx";
import { query, marketSnapshot, loadReports } from "../store.js";

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function getZonedTimeParts(timeZone, now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    weekday: map.weekday,
    minutes: Number(map.hour) * 60 + Number(map.minute)
  };
}

function inSession(minutes, sessions) {
  return sessions.some(([start, end]) => minutes >= start && minutes < end);
}

function getMarketStatus(now = new Date()) {
  const sh = getZonedTimeParts("Asia/Shanghai", now);
  const ny = getZonedTimeParts("America/New_York", now);
  const shTradingDay = WEEKDAYS.has(sh.weekday);
  const nyTradingDay = WEEKDAYS.has(ny.weekday);
  const aOpen = shTradingDay && inSession(sh.minutes, [[570, 690], [780, 900]]);
  const hkOpen = shTradingDay && inSession(sh.minutes, [[570, 720], [780, 960]]);
  const usOpen = nyTradingDay && inSession(ny.minutes, [[570, 960]]);
  return [
    { key: "A", label: "A股", open: aOpen },
    { key: "HK", label: "港股", open: hkOpen },
    { key: "US", label: "美股", open: usOpen }
  ];
}

function inferRegion(item) {
  const code = String(item.code || "").toUpperCase();
  const name = String(item.name || "");
  if (code.includes("HSI") || name.includes("恒生")) return "HK";
  if (code.includes("NDX") || code.includes("IXIC") || code.includes("SPX") || name.includes("纳斯达克") || name.includes("标普")) return "US";
  return "A";
}

function getIndexPriority(item, region) {
  const code = String(item.code || "").toUpperCase();
  const name = String(item.name || "");
  if (region === "A") {
    if (code === "000001" || name.includes("上证")) return 10;
    if (code === "000688" || name.includes("科创")) return 20;
    if (code === "399006" || name.includes("创业")) return 30;
    if (code === "399001" || name.includes("深证")) return 40;
    return 90;
  }
  if (region === "US") {
    if (code.includes("NDX") || code.includes("IXIC") || name.includes("纳斯达克") || name.includes("纳指")) return 10;
    if (code.includes("SPX") || name.includes("标普")) return 20;
    return 90;
  }
  if (region === "HK") return name.includes("恒生") ? 10 : 90;
  return 99;
}

function dedupeIndices(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.region}:${item.code || item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMarketDisplay(items, statuses) {
  const statusMap = Object.fromEntries(statuses.map((s) => [s.key, s.open]));
  const normalized = dedupeIndices(items.map((item) => {
    const region = inferRegion(item);
    return { ...item, region, priority: getIndexPriority(item, region) };
  })).sort((a, b) => a.priority - b.priority || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));

  const regionOrder = statusMap.US ? ["US", "A", "HK"] : ["A", "HK", "US"];
  const pageSize = statusMap.US ? 4 : 5;
  const ordered = regionOrder.flatMap((region) => normalized.filter((item) => item.region === region));
  return { ordered, pageSize };
}

function getPagedItems(items, offset, pageSize) {
  if (items.length <= pageSize) return items;
  return Array.from({ length: pageSize }, (_, index) => items[(offset + index) % items.length]);
}

function formatChangePct(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function trendClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number >= 0 ? "up" : "down";
}

function MarketIndexCard({ item }) {
  return (
    <span class="top-market-card" title={`${item.name} ${item.level || "--"} ${formatChangePct(item.changePct)}`}>
      <span class="top-market-name">{item.name}</span>
      <span class={`top-market-pct ${trendClass(item.changePct)}`}>{formatChangePct(item.changePct)}</span>
    </span>
  );
}

export function Layout({ route, auth, onLogout, children }) {
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [marketOffset, setMarketOffset] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setMarketOffset(0);
  }, [route]);

  const handleSearch = (e) => {
    query.value = e.target.value.trim();
    loadReports();
  };

  const snap = marketSnapshot.value;
  const items = snap?.indices || [];
  const statuses = getMarketStatus(new Date(clockTick));
  const marketDisplay = buildMarketDisplay(items, statuses);
  const marketItems = getPagedItems(marketDisplay.ordered, marketOffset, marketDisplay.pageSize);
  const canPageMarket = marketDisplay.ordered.length > marketDisplay.pageSize;
  const shiftMarketPage = (direction) => {
    if (!canPageMarket) return;
    setMarketOffset((offset) => {
      const next = offset + direction * marketDisplay.pageSize;
      const length = marketDisplay.ordered.length;
      return ((next % length) + length) % length;
    });
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
          <div class="top-market-wrap">
            <button
              type="button"
              class="top-market-arrow"
              aria-label="上一组行情"
              disabled={!canPageMarket}
              onClick={() => shiftMarketPage(-1)}
            >
              ‹
            </button>
            <div class="top-market-list" aria-label="重点指数行情" style={{ "--market-count": marketDisplay.pageSize }}>
              {marketItems.map((item, index) => (
                <MarketIndexCard key={`${marketOffset}-${index}-${item.region}-${item.code || item.name}`} item={item} />
              ))}
            </div>
            <button
              type="button"
              class="top-market-arrow"
              aria-label="下一组行情"
              disabled={!canPageMarket}
              onClick={() => shiftMarketPage(1)}
            >
              ›
            </button>
          </div>
          <div class="market-status">
            {statuses.map(s => (
              <span key={s.key} class={`market-dot ${s.open ? "open" : ""}`}>{s.label}</span>
            ))}
          </div>
          {auth?.authRequired && (
            <button class="logout-button" type="button" onClick={onLogout}>退出</button>
          )}
        </header>
        <section class="view">{children}</section>
      </main>
      <Toast />
    </div>
  );
}
