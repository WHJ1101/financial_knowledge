import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { stocks, positions, indices, loadPortfolio } from "../store.js";
import { PortfolioAnalysisPanel } from "./portfolio/PortfolioAnalysisPanel.jsx";
import { PortfolioOverview } from "./portfolio/PortfolioOverview.jsx";
import { DetailPanel } from "./portfolio/PortfolioDetailPanel.jsx";
import { EtfPanel } from "./portfolio/EtfPanel.jsx";
import { PositionPanel } from "./portfolio/PositionPanel.jsx";
import { StockPanel } from "./portfolio/StockPanel.jsx";
import { post } from "../api.js";
import {
  buildHoldings, sortHoldings, getOverview, buildPortfolioAnalysis
} from "../lib/portfolio-analysis.js";
import { positionQuoteKey } from "../lib/position-math.js";

const TABS = [
  { key: "positions", label: "持仓" },
  { key: "analysis", label: "组合分析" },
  { key: "stocks", label: "自选股" },
  { key: "etfs", label: "指数基金" }
];

export function Portfolio() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedKey, setSelectedKey] = useState("");
  const [positionSort, setPositionSort] = useState({ key: "default", direction: "desc" });
  const [quoteRevision, setQuoteRevision] = useState(0);
  const prices = usePositionPrices(positions.value, quoteRevision);
  const holdings = useMemo(() => buildHoldings(positions.value, prices), [positions.value, prices]);
  const sortedHoldings = useMemo(() => sortHoldings(holdings, positionSort), [holdings, positionSort]);
  const portfolioAnalysis = useMemo(() => buildPortfolioAnalysis(holdings), [holdings]);
  const etfs = indices.value.filter(i => i.relatedEtfs?.length > 0);

  useAnalysisPoller([...stocks.value, ...positions.value]);

  useEffect(() => { setSelectedKey(""); }, [activeTab]);

  const selected = getSelected(activeTab, selectedKey, sortedHoldings, stocks.value, etfs);
  const overview = getOverview(holdings, stocks.value, etfs);

  const handleSelect = (key) => setSelectedKey(String(key));
  const handleTab = (key) => { setActiveTab(key); setSelectedKey(""); };
  const handleQuoteChange = () => setQuoteRevision(v => v + 1);

  const handlePositionSort = (key) => {
    setPositionSort(current => {
      if (key === "default") return { key: "default", direction: "desc" };
      if (current.key === key) {
        return { key, direction: current.direction === "desc" ? "asc" : "desc" };
      }
      return { key, direction: "desc" };
    });
  };

  return (
    <div class="nav-page portfolio-page">
      <div class="page-head portfolio-head">
        <div>
          <h1>投资组合</h1>
          <p class="page-description">用表格快速扫描，用详情区阅读 AI 分析和风险复核。</p>
        </div>
        <div class="portfolio-head-actions">
          <a class="ghost-button" href="/api/export/positions.csv">导出 CSV</a>
          <a class="ghost-button" href="/api/export/positions.json">导出 JSON</a>
        </div>
      </div>

      <PortfolioOverview overview={overview} />

      <section class="portfolio-workbench">
        <div class="portfolio-tabs" role="tablist" aria-label="投资组合视图">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              class={`portfolio-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => handleTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div class={`portfolio-layout ${activeTab === "analysis" ? "analysis-mode" : ""}`}>
          <div class="portfolio-main">
            {activeTab === "positions" && (
              <PositionPanel holdings={sortedHoldings} selectedKey={selectedKey} sort={positionSort} onSort={handlePositionSort} onSelect={handleSelect} />
            )}
            {activeTab === "analysis" && (
              <PortfolioAnalysisPanel analysis={portfolioAnalysis} />
            )}
            {activeTab === "stocks" && (
              <StockPanel selectedKey={selectedKey} onSelect={handleSelect} />
            )}
            {activeTab === "etfs" && (
              <EtfPanel etfs={etfs} selectedKey={selectedKey} onSelect={handleSelect} />
            )}
          </div>

          {activeTab !== "analysis" && <DetailPanel activeTab={activeTab} selected={selected} onQuoteChange={handleQuoteChange} />}
        </div>
      </section>
    </div>
  );
}

function useAnalysisPoller(items) {
  const timer = useRef(null);
  const signature = items.map(i => `${i.id || i.code}:${i.analysisStatus}`).join("|");
  useEffect(() => {
    const hasAnalyzing = items.some(i => i.analysisStatus === "analyzing");
    if (hasAnalyzing && !timer.current) {
      timer.current = setInterval(() => loadPortfolio(), 3000);
    } else if (!hasAnalyzing && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [signature]);
}

function usePositionPrices(items, revision = 0) {
  const [quotes, setQuotes] = useState({});
  const signature = items.map(p => String(p.code || "") + ":" + String(p.quoteSecid || p.quote_secid || "")).join("|");
  useEffect(() => {
    if (!items.length) { setQuotes({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await post("/api/quotes/batch", {
          items: items.map(p => ({ code: p.code, quoteSecid: positionQuoteKey(p) }))
        });
        if (!cancelled) setQuotes(data.quotes || {});
      } catch {
        if (!cancelled) setQuotes({});
      }
    })();
    return () => { cancelled = true; };
  }, [signature, revision]);
  return quotes;
}

function getSelected(activeTab, selectedKey, holdings, stockRows, etfs) {
  if (activeTab === "analysis") return null;
  if (activeTab === "positions") return holdings.find(row => String(row.id) === String(selectedKey)) || holdings[0];
  if (activeTab === "stocks") return stockRows.find(row => String(row.code) === String(selectedKey)) || stockRows[0];
  return etfs.find(row => String(row.code) === String(selectedKey)) || etfs[0];
}
