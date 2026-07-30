/** 状态概览 + 研报生产 + 日更 hooks（方案 §11.9/§11.2/§8.3）。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface StatusView {
  app: string;
  now: string;
  today: string;
  nowDisplay: string;
  todayUpdates: number;
  unreadCount: number;
  recentCount: number;
  reportCount: number;
  originCounts: { automation: number; manual: number };
  llm: { configured: boolean };
  market: { ready: boolean };
  settings: { automationEnabled: boolean; dailyScheduleTime: string | null; llmConfigured: boolean };
  operations?: {
    latest_run: { id: string; status: string; kind: string } | null;
    sources: Array<{ source_key: string; health: string }>;
  };
}

export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: () => api.get<StatusView>("/status") });
}

export interface ReportCreated {
  id: string;
  title: string;
  type: string;
  summary: string | null;
}

export interface AutomationRunCreated {
  run_id: string;
  status: "queued";
  poll_url: string;
}

/** 发起主题研究（BYOK 未配则后端降级证据草稿）。 */
export function useCreateResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { topic: string; type: string }) => api.post<ReportCreated>("/research", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
}

/** 日更入队（超管）；执行状态由任务页轮询运行台账。 */
export function useRunDaily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AutomationRunCreated>("/jobs/daily"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-runs"] });
    },
  });
}
