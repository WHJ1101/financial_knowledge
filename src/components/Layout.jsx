import { Sidebar } from "./Sidebar.jsx";
import { Toast } from "./Toast.jsx";
import { query, marketSnapshot, loadReports } from "../store.js";

function getMarketStatus() {
  const now = new Date();
  const sh = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" }).formatToParts(now);
  const shParts = Object.fromEntries(sh.map(p => [p.type, p.value]));
  const shH = Number(shParts.hour), shM = Number(shParts.minute), shDay = shParts.weekday;
  const ny = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(now);
  const nyParts = Object.fromEntries(ny.map(p => [p.type, p.value]));
  const nyH = Number(nyParts.hour), nyDay = nyParts.weekday;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const aOpen = weekdays.includes(shDay) && ((shH === 9 && shM >= 30) || (shH >= 10 && shH < 11) || (shH === 11 && shM <= 30) || (shH >= 13 && shH < 15));
  const hkOpen = weekdays.includes(shDay) && ((shH === 9 && shM >= 30) || (shH >= 10 && shH < 12) || (shH >= 13 && shH < 16));
  const usOpen = weekdays.includes(nyDay) && (nyH >= 9 && nyH < 16);
  return [
    { label: "A股", open: aOpen },
    { label: "港股", open: hkOpen },
    { label: "美股", open: usOpen },
  ];
}

export function Layout({ route, auth, onLogout, children }) {
  const handleSearch = (e) => {
    query.value = e.target.value.trim();
    loadReports();
  };

  const snap = marketSnapshot.value;
  const items = snap?.indices || [];
  const statuses = getMarketStatus();

  return (
    <div class="app-shell">
      <Sidebar route={route} />
      <main class="main">
        <header class="topbar">
          <label class="search-box">
            <span>⌕</span>
            <input type="search" placeholder="搜索报告、标的..." onInput={handleSearch} autocomplete="off" />
          </label>
          <div class="ticker-wrap">
            <div class="ticker-track">
              {items.map(i => (
                <span key={i.code} class="ticker-item">
                  <span class="ticker-name">{i.name}</span>
                  <span class="ticker-level">{i.level || "--"}</span>
                  <span class={`ticker-pct ${Number(i.changePct) >= 0 ? "up" : "down"}`}>{i.changePct ? `${Number(i.changePct) >= 0 ? "+" : ""}${i.changePct}%` : "--"}</span>
                </span>
              ))}
            </div>
          </div>
          <div class="market-status">
            {statuses.map(s => (
              <span key={s.label} class={`market-dot ${s.open ? "open" : ""}`}>{s.label}</span>
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
