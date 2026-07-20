/** 决策/辩论 hooks（方案 §8.4）：列表、详情轮询、创建、取消、检查点重试。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface DebateView {
  id: string;
  instrument_id: string;
  instrument_name: string;
  instrument_code: string;
  horizon: "short" | "swing" | "long";
  question: string | null;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  stage: string | null;
  verdict: string | null;
  confidence: number | null;
  report: DebateReport | null;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  model_assignments: Record<string, { profile_name: string; model: string; provider_host: string }>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export interface DebateReport {
  target: { name: string; code: string; market: string };
  evidence_snapshot?: Record<string, Record<string, unknown>>;
  analysts: Record<string, { stance: string; points: string[]; confidence: number; data_gaps: string[] }>;
  debate: {
    bull: { points: string[]; rebuttal: string; confidence: number; data_gaps: string[] };
    bear: { points: string[]; rebuttal: string; confidence: number; data_gaps: string[] };
  };
  judge: {
    verdict: string;
    confidence: number;
    key_disagreements: string[];
    bull_case: string;
    bear_case: string;
    falsifiers: string[];
    action: { stance: string; trigger: string; stop_loss: string };
    data_caveats: string[];
  } | null;
  risk_review: { risks: string[]; overall: string } | null;
  data_gaps: string[];
  disclaimer: string;
  horizon: string;
  question: string | null;
  model_assignments: Record<string, { profile_name: string; model: string; provider_host: string }>;
}

export interface LegacyDecision {
  id: string;
  date: string | null;
  title: string;
  summary: string | null;
  action: string | null;
  market: string | null;
  positionAdvice: unknown[];
  stockAdvice: unknown[];
  reports: unknown[];
  createdAt: string | null;
}

export function debateListRefetchInterval(data: DebateView[] | undefined): number | false {
  return data?.some((debate) => debate.status === "queued" || debate.status === "running") ? 2000 : false;
}

export function useDebates() {
  return useQuery({
    queryKey: ["debates"],
    queryFn: () => api.get<DebateView[]>("/debates"),
    refetchInterval: (query) => debateListRefetchInterval(query.state.data),
  });
}

export function useLegacyDecisions(enabled: boolean) {
  return useQuery({
    queryKey: ["legacy-decisions"],
    queryFn: () => api.get<{ decisions: LegacyDecision[] }>("/decisions"),
    enabled,
  });
}

/** 详情轮询：running/queued 时每 2s 刷新，终态停止（方案 §8.4，复用 useAnalysisPoller 范式）。 */
export function useDebate(id: string | null) {
  return useQuery({
    queryKey: ["debate", id],
    queryFn: () => api.get<DebateView>(`/debates/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const debate = query.state.data;
      if (debate?.status !== "queued" && debate?.status !== "running") return false;
      const lastUpdate = Date.parse(debate.updated_at);
      return Number.isFinite(lastUpdate) && Date.now() - lastUpdate <= 15 * 60_000 ? 2000 : false;
    },
  });
}

export function useCreateDebate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { instrument_id: string; horizon?: string; question?: string }) =>
      api.post<{ id: string; status: string }>("/debates", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debates"] });
    },
  });
}

export function useCancelDebate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<DebateView>(`/debates/${id}/cancel`),
    onSuccess: (data) => {
      qc.setQueryData(["debate", data.id], data);
      qc.invalidateQueries({ queryKey: ["debates"] });
    },
  });
}

export function useResumeDebate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<DebateView>(`/debates/${id}/resume`),
    onSuccess: (data) => {
      qc.setQueryData(["debate", data.id], data);
      qc.invalidateQueries({ queryKey: ["debates"] });
    },
  });
}
