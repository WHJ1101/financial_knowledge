/** 信号源 hooks（方案 §8.3/§4.4/§11.5）：公共信号 + 个人确认/忽略态 + 飞书同步。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface SignalView {
  id: string;
  date: string;
  source: string;
  source_title: string | null;
  source_url: string | null;
  theme: string | null;
  industry: string | null;
  related_assets: string[];
  summary: string | null;
  evidence: string | null;
  signal_type: string | null;
  confidence: string;
  verification_status: string;
  importance: number;
  state: "unread" | "confirmed" | "ignored";
  version_no: number;
}

export function useSignals() {
  return useQuery({ queryKey: ["signals"], queryFn: () => api.get<SignalView[]>("/signals") });
}

export function useSetSignalState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: SignalView["state"] }) =>
      api.post(`/signals/${id}/state`, { state }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signals"] }),
  });
}

export interface SignalSyncRun {
  id: string;
  source_key: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed" | "canceled";
  stage: string | null;
  range_start: string | null;
  range_end: string | null;
  scanned_count: number;
  changed_count: number;
  written_count: number;
  failed_count: number;
  error_code: string | null;
  error_message: string | null;
  result_summary: {
    processed_dates?: string[];
    failure_dates?: string[];
    content_only_dates?: string[];
  };
  created_at: string;
  finished_at: string | null;
}

export interface SignalSyncCreated {
  run_id: string;
  status: "queued";
  poll_url: string;
}

export function useLatestSignalSync(enabled = true) {
  return useQuery({
    queryKey: ["signal-sync-latest"],
    queryFn: () => api.get<SignalSyncRun | null>("/signals/sync-runs/latest"),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    },
  });
}

/** 飞书增量或日期回补入队（超管）。 */
export function useSyncSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      mode: "incremental" | "backfill";
      date_from: string | null;
      date_to: string | null;
    }) => api.post<SignalSyncCreated>("/signals/sync-runs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signal-sync-latest"] }),
  });
}

export function useRetrySignalSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<SignalSyncCreated>(`/signals/sync-runs/${runId}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signal-sync-latest"] }),
  });
}
