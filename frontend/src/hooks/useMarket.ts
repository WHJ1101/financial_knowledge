/** 压力监控 + 组合曲线 hooks（方案 §11.7/§13）。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { PositionAnalysisDetail } from "@/hooks/usePortfolio";

export interface IndexLive {
  code: string;
  name: string;
  level: string | null;
  changePct: string | null;
  volume: unknown;
}

export interface MarketSnapshot {
  indices: IndexLive[];
  updatedAt: string | null;
  attemptedAt: string | null;
  status: "loading" | "ok" | "empty" | "stale" | "unavailable";
}

export interface MarketIndexRow {
  code: string;
  region: string;
  name: string;
  level: string | null;
  changePct: string | null;
  relatedEtfs: string[];
}

/** 指数快照（内存缓存，交易时段轮询刷新）。 */
export function useMarketSnapshot() {
  return useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => api.get<MarketSnapshot>("/market/snapshot"),
    refetchInterval: 60_000,
  });
}

export interface MarketSession {
  key: string;
  label: string;
  open: boolean;
  calendar: string;
}

export function useMarketSessions() {
  return useQuery({
    queryKey: ["market-sessions"],
    queryFn: () => api.get<{ sessions: MarketSession[] }>("/market/sessions").then((result) => result.sessions),
    refetchInterval: 60_000,
  });
}

/** DB 指数（含 relatedEtfs，供 ETF/指数基金 tab）。 */
export function useMarketIndices() {
  return useQuery({
    queryKey: ["market-indices"],
    queryFn: () => api.get<{ indices: MarketIndexRow[] }>("/market/indices").then((r) => r.indices),
    refetchInterval: 60_000,
  });
}

export interface PressureSubScore {
  key: string;
  label: string;
  score: number | null;
  rawText: string;
}
export interface PressureTheme {
  id: string;
  name: string;
  market: string;
  date: string | null;
  composite: number | null;
  subScores: PressureSubScore[];
  series30: { date: string; composite: number | null }[];
  status: string;
  crossing: string | null;
}

export function usePressure() {
  return useQuery({
    queryKey: ["pressure"],
    queryFn: () => api.get<{ themes: PressureTheme[] }>("/pressure").then((r) => r.themes),
  });
}

export function useSyncPressure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/pressure/sync"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pressure"] }),
  });
}

export interface PortfolioPoint {
  date: string;
  marketValue: number;
  pnl: number;
  pnlPct: number | null;
  coveredCount: number;
}
export interface PortfolioHistory {
  range: string;
  asOf: string | null;
  fullCoverageSince: string | null;
  series: PortfolioPoint[];
  coverage: {
    total: number;
    covered: number;
    positionCoverage: number;
    costCoverage: number;
    skipped: { code: string; name: string; reason: string }[];
    assets: { code: string; name: string; secid: string; firstDate: string; lastDate: string }[];
  };
}

export function usePortfolioHistory(range: "6m" | "all") {
  return useQuery({
    queryKey: ["portfolio-history", range],
    queryFn: () => api.get<PortfolioHistory>(`/portfolio/history?range=${range}`),
  });
}

// ---- 组合分析（实时行情 + 分布/归因/健康度/主题穿透，§11.4）----

export interface DistRow {
  label: string;
  value: number;
  count: number;
  weight: number;
}
export interface AnalysisHolding {
  id: string;
  code: string;
  name: string;
  market: string;
  shares: number;
  cost: number;
  price: number | null;
  changePct: string | null;
  quoteSource: string | null;
  marketValue: number;
  pnl: number | null;
  pnlPct: number | null;
  weight: number;
  risk: string | null;
  reason: string | null;
  analysisDetail: PositionAnalysisDetail;
  analysisStatus: string;
}
export interface PortfolioAnalysis {
  overview: {
    marketValue: number;
    pnl: number;
    pnlPct: number;
    analyzingCount: number;
    highRiskCount: number;
    positionCount: number;
  };
  analysis: {
    count: number;
    totalMarket: number;
    pnl: number;
    pnlPct: number;
    largestHolding: { name: string; weight: number } | null;
    maxWeight: number;
    top5Weight: number;
    topMarketWeight: number;
    topAssetWeight: number;
    highRiskCount: number;
    priceCoverage: number;
    costCoverage: number;
    themeCoverage: number;
    marketRows: DistRow[];
    assetRows: DistRow[];
    riskRows: DistRow[];
    themeRows: { label: string; value: number; weight: number; contributors: { name: string; value: number }[] }[];
    pnlRows: { label: string; value: number; detailPct: number | null; tone: string }[];
    healthScore: number;
    healthTone: string;
    healthLabel: string;
    healthAlerts: { text: string; tone: string }[];
    healthFactors: { label: string; value: number; percent: number }[];
  };
  holdings: AnalysisHolding[];
}

export function portfolioAnalysisRefetchInterval(data: PortfolioAnalysis | undefined): number | false {
  return data?.holdings.some((holding) => holding.analysisStatus === "analyzing") ? 2000 : false;
}

export function usePortfolioAnalysis(enabled = true) {
  return useQuery({
    queryKey: ["portfolio-analysis"],
    queryFn: () => api.get<PortfolioAnalysis>("/portfolio/analysis"),
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) => portfolioAnalysisRefetchInterval(query.state.data),
  });
}

// ---- 搜索 / 单标的行情 / 手动行情覆盖 / 关联报告（持仓明细面板用）----

export interface SearchResult {
  code: string;
  name: string;
  market: string;
  secid: string;
  candidateToken?: string;
}

export async function searchStocks(q: string): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  const r = await api.get<{ results: Array<{
    canonical_symbol: string;
    display_code: string;
    name: string;
    market: string;
    candidate_token: string;
  }> }>(`/instruments/search?q=${encodeURIComponent(q)}`);
  return r.results.map((item) => ({
    code: item.display_code || item.canonical_symbol,
    name: item.name,
    market: item.market,
    secid: item.candidate_token,
    candidateToken: item.candidate_token,
  }));
}

export interface AssetReportLink {
  id: string;
  relation: string;
  report: { id: string; title: string; typeLabel: string | null; localDate: string | null };
}

export function useAssetReports(code: string | null) {
  return useQuery({
    queryKey: ["asset-reports", code],
    queryFn: () => api.get<{ reports: AssetReportLink[] }>(`/assets/${encodeURIComponent(code!)}/reports`).then((r) => r.reports),
    enabled: !!code,
  });
}

export function useUpsertQuoteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string; name?: string; market?: string; price: number; changePct?: string; note?: string }) =>
      api.post("/quote-overrides", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-analysis"] }),
  });
}

export function useDeleteQuoteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.del(`/quote-overrides/${encodeURIComponent(code)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-analysis"] }),
  });
}
