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
