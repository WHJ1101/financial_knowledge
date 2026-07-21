/** 顶栏行情条（移植 Layout.jsx 的 MarketTicker，方案 §11.F）。
 * 指数 ticker（分页轮转）+ A/HK/US 开市状态 + 时钟。数据来自 /market/snapshot（轮询）。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketSessions, useMarketSnapshot, type IndexLive } from "@/hooks/useMarket";
import { ThemeToggle } from "@/components/ThemeToggle";

function inferRegion(item: IndexLive): string {
  const code = (item.code || "").toUpperCase();
  const name = item.name || "";
  if (code.includes("HSI") || name.includes("恒生")) return "HK";
  if (/NDX|IXIC|SPX/.test(code) || name.includes("纳斯达克") || name.includes("标普")) return "US";
  return "A";
}

function fmtPct(v: string | null): string {
  if (v == null || v === "") return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function trend(v: string | null): string {
  const n = Number(v);
  return Number.isFinite(n) ? (n >= 0 ? "up" : "down") : "";
}

export function MarketTicker() {
  const snap = useMarketSnapshot();
  const sessionQuery = useMarketSessions();
  const navigate = useNavigate();
  const [tick, setTick] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(() => window.innerWidth < 620 ? 1 : window.innerWidth < 1100 ? 3 : 5);
  const [search, setSearch] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const scrollSentinel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const resize = () => setPageSize(window.innerWidth < 620 ? 1 : window.innerWidth < 1100 ? 3 : 5);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!scrollSentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(scrollSentinel.current);
    return () => observer.disconnect();
  }, []);

  const statuses = sessionQuery.data ?? [];
  const items = useMemo(() => {
    const rows = snap.data?.indices ?? [];
    const order = ["A", "HK", "US"];
    return [...rows]
      .map((r) => ({ ...r, region: inferRegion(r) }))
      .sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region));
  }, [snap.data]);

  const canPage = items.length > pageSize;
  const shown = canPage
    ? Array.from({ length: pageSize }, (_, i) => items[(offset + i) % items.length])
    : items;
  const shift = (dir: number) => {
    if (!canPage) return;
    setOffset((o) => ((o + dir * pageSize) % items.length + items.length) % items.length);
  };
  const clock = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(tick));
  const submitSearch = () => {
    const q = search.trim();
    navigate(q ? `/knowledge?q=${encodeURIComponent(q)}` : "/knowledge?focus=search");
    setSearch("");
  };
  const emptyState = snap.isLoading || snap.data?.status === "loading"
    ? "行情加载中…"
    : snap.data?.status === "unavailable"
      ? "行情暂不可用"
      : "暂无行情数据";

  return (
    <Fragment>
      <span ref={scrollSentinel} className="topbar-scroll-sentinel" aria-hidden="true" />
      <header className="topbar" data-scrolled={scrolled || undefined}>
      <div className="ticker-wrap">
        {canPage && (
          <button className="ticker-arrow" onClick={() => shift(-1)} aria-label="上一组">
            ‹
          </button>
        )}
        <div
          className="ticker-list"
          title={snap.data?.status === "stale" ? "当前展示上一次成功行情" : undefined}
        >
          {shown.length === 0 && (
            snap.isError ? (
              <button className="ticker-empty text-button" onClick={() => snap.refetch()} title="点击重试">
                行情加载失败
              </button>
            ) : (
              <span className="ticker-empty" aria-live="polite">{emptyState}</span>
            )
          )}
          {shown.map((it, i) => (
            <span className="ticker-item" key={`${offset}-${i}-${it.code}`} title={`${it.name} ${it.level ?? "--"}`}>
              <span className="ticker-name">{it.name}</span>
              <span className="ticker-level">{it.level ?? "--"}</span>
              <span className={`ticker-pct ${trend(it.changePct)}`}>{fmtPct(it.changePct)}</span>
            </span>
          ))}
        </div>
        {canPage && (
          <button className="ticker-arrow" onClick={() => shift(1)} aria-label="下一组">
            ›
          </button>
        )}
      </div>
      <div className="topbar-right">
        <form className="global-search" onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}>
          <label className="sr-only" htmlFor="global-report-search">全局搜索报告</label>
          <input
            id="global-report-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitSearch();
            }}
            placeholder="搜索知识库"
          />
        </form>
        <ThemeToggle />
        <div className="market-status">
          {sessionQuery.isError ? (
            <button className="market-status-retry text-button" onClick={() => sessionQuery.refetch()}>
              交易时段不可用
            </button>
          ) : (
            statuses.map((s) => (
              <span key={s.key} className={`market-dot ${s.open ? "open" : ""}`}>
                {s.label}
              </span>
            ))
          )}
        </div>
        <span className="topbar-clock">{clock}</span>
      </div>
      </header>
    </Fragment>
  );
}
