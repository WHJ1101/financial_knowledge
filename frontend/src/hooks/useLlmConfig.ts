import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface LlmProfile {
  id: string;
  name: string;
  provider_host: string | null;
  model: string;
  key_hint: string;
  enabled: boolean;
  is_default: boolean;
}

export interface LlmRoute {
  role: string;
  profile_id: string;
  temperature: number;
}

export interface LlmSettings {
  profiles: LlmProfile[];
  routes: LlmRoute[];
  available_roles: string[];
}

const KEY = ["llm-settings"] as const;

export function useLlmConfig() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<LlmSettings>("/settings/llm") });
}

export function useCreateLlmProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; api_key: string; api_url: string; model: string; is_default: boolean }) =>
      api.post<LlmProfile>("/settings/llm/profiles", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateLlmProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      api_key?: string;
      api_url?: string;
      model?: string;
      enabled?: boolean;
      is_default?: boolean;
    }) =>
      api.patch<LlmProfile>(`/settings/llm/profiles/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLlmProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/settings/llm/profiles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveLlmRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LlmRoute[]) => api.put<LlmRoute[]>("/settings/llm/routes", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
