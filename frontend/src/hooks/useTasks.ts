/** 任务自动化 hooks（方案 §11.6，超管）：任务 CRUD/启停/定时 + 日志 + 全局开关。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface AutomationTask {
  id: string;
  name: string;
  enabled: boolean;
  goal: string;
  implementation: string;
  schedule: string;
  scheduleTime: string;
  executable: boolean;
  updatedAt: string | null;
}

export interface LogEntry {
  id: string;
  type: string | null;
  message: string | null;
  meta: Record<string, unknown>;
  localTime: string | null;
}

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "canceled";

export interface AutomationRunStep {
  key: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  count?: number;
  error_code?: string;
  error_message?: string;
}

export interface AutomationRun {
  id: string;
  kind: string;
  trigger: "manual" | "schedule" | "retry";
  status: AutomationRunStatus;
  current_step: string | null;
  steps: AutomationRunStep[];
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ResearchCapability {
  key: string;
  function: string;
  upstream_family: string;
  freshness_seconds: number;
  consumers: string[];
}

export interface ResearchDataHealth {
  manifest_version: string;
  akshare_version: string;
  capability_count: number;
  available_capability_count: number;
  baseline_capability_count: number;
  baseline_available_count: number;
  contextual_capability_count: number;
  contextual_available_count: number;
  orphaned_snapshot_capability_count: number;
  latest: Record<string, { retrieved_at: string; snapshot_count: number }>;
  recent_failures: Array<{
    id: string;
    capability_key: string | null;
    status: AutomationRunStatus;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  }>;
}

export function useTasks() {
  return useQuery({
    queryKey: ["automation-tasks"],
    queryFn: () => api.get<{ tasks: AutomationTask[] }>("/automation/tasks").then((r) => r.tasks),
  });
}

export function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: () => api.get<{ logs: LogEntry[] }>("/logs").then((r) => r.logs),
  });
}

export function useAutomationRuns() {
  return useQuery({
    queryKey: ["automation-runs"],
    queryFn: () => api.get<{ runs: AutomationRun[] }>("/automation/runs").then((r) => r.runs),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "queued" || run.status === "running") ? 2_000 : false,
  });
}

export function useResearchDataHealth() {
  return useQuery({
    queryKey: ["research-data-health"],
    queryFn: () => api.get<ResearchDataHealth>("/research-data/health"),
    refetchInterval: 15_000,
  });
}

export function useResearchCapabilities() {
  return useQuery({
    queryKey: ["research-data-capabilities"],
    queryFn: () =>
      api
        .get<{ capabilities: ResearchCapability[] }>("/research-data/capabilities")
        .then((response) => response.capabilities),
  });
}

export function useRefreshResearchCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (capabilityKey: string) =>
      api.post<{ run_id: string }>("/research-data/refresh", {
        capability_key: capabilityKey,
        subject_key: "macro:CN",
        parameters: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-data-health"] });
    },
  });
}

function useTaskMutation<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-tasks"] }),
  });
}

export const useCreateTask = () =>
  useTaskMutation((body: { name: string; goal: string; implementation: string; schedule?: string }) =>
    api.post("/automation/tasks", body),
  );

export const useToggleTask = () =>
  useTaskMutation((id: string) => api.post(`/automation/tasks/${id}/toggle`));

export const useUpdateTaskSchedule = () =>
  useTaskMutation((v: { id: string; time: string }) =>
    api.post(`/automation/tasks/${v.id}/schedule`, { time: v.time }),
  );

export function useToggleAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled?: boolean) => api.post("/automation/toggle", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
}
