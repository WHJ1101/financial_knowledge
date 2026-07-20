/** 持仓/自选 hooks（方案 §8.3）：列表 + 增删改，写请求带 CSRF。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface PositionView {
  id: string;
  instrument_id: string;
  code: string;
  name: string;
  market: string;
  shares: number;
  cost: number;
  reason: string | null;
  risk: string | null;
  analysis_detail: PositionAnalysisDetail;
  analysis_status: string;
}

export interface PositionAnalysisDetail {
  summary?: string;
  trend?: string;
  fundamentals?: string;
  macro?: string;
  theme_news?: string;
  triggers?: string[];
  evidence_used?: string[];
  data_gaps?: string[];
  generated_at?: string;
}
export interface WatchlistItemView {
  id: string;
  instrument_id: string;
  code: string;
  name: string;
  market: string;
  status: string;
  thesis: string | null;
  advice: string | null;
  risk: string | null;
  watch_signals: string[];
  analysis_status: string;
}

export function analysisListRefetchInterval(
  data: ReadonlyArray<{ analysis_status: string }> | undefined,
): number | false {
  return data?.some((item) => item.analysis_status === "analyzing") ? 2000 : false;
}

export function usePositions() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: () => api.get<PositionView[]>("/positions"),
    refetchInterval: (query) => analysisListRefetchInterval(query.state.data),
  });
}
export function useWatchlist() {
  return useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get<WatchlistItemView[]>("/watchlist"),
    refetchInterval: (query) => analysisListRefetchInterval(query.state.data),
  });
}

export interface PositionUpsert {
  code: string;
  name: string;
  market: string;
  shares: number;
  cost: number;
  reason?: string;
}

export function useAddPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PositionUpsert) => api.post<PositionView>("/positions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analysis"] });
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, shares, cost }: { id: string; shares: number; cost: number }) =>
      api.patch<PositionView>(`/positions/${id}`, { shares, cost }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analysis"] });
    },
  });
}

export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/positions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analysis"] });
    },
  });
}

export interface WatchlistUpsert {
  code: string;
  name: string;
  market: string;
  status?: string;
  thesis?: string;
}

export function useAddWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WatchlistUpsert) => api.post<WatchlistItemView>("/watchlist", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/watchlist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

/** 触发持仓/自选智能分析（异步 worker 任务，返回 202）。 */
export function useAnalyzePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/positions/${id}/analyze`),
    onSuccess: (_result, id) => {
      qc.setQueryData<PositionView[]>(["positions"], (items) =>
        items?.map((item) => item.id === id ? { ...item, analysis_status: "analyzing" } : item));
      qc.invalidateQueries({ queryKey: ["portfolio-analysis"] });
    },
  });
}

export function useAnalyzeWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/watchlist/${id}/analyze`),
    onSuccess: (_result, id) => qc.setQueryData<WatchlistItemView[]>(["watchlist"], (items) =>
      items?.map((item) => item.id === id ? { ...item, analysis_status: "analyzing" } : item)),
  });
}
