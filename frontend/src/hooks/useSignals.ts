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

export interface SignalSyncResult {
  ok: boolean;
  skipped: boolean;
  reason: string;
  written: number;
  processed_dates: string[];
}

/** 同步飞书社群信号（超管）。 */
export function useSyncSignals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SignalSyncResult>("/signals/sync"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signals"] }),
  });
}
