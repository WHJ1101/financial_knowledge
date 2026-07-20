/** 会话/用户 hooks（方案 §8.3，TanStack Query）。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ensureCsrf } from "@/api/client";

export interface UserView {
  username: string;
  role: "superadmin" | "member";
  status: string;
}
interface SessionView {
  authenticated: boolean;
  user: UserView | null;
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<SessionView>("/auth/session"),
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { username: string; password: string }) => {
      await ensureCsrf();
      return api.post<SessionView>("/auth/login", body);
    },
    // 直接写入 session 缓存 + 失效，避免"登录成功但 Protected 仍读到旧的未登录态"竞态
    onSuccess: (data) => {
      qc.setQueryData(["session"], data);
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { invite_code: string; username: string; password: string }) => {
      await ensureCsrf();
      return api.post<SessionView>("/auth/register", body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export interface InviteView {
  id: string;
  code: string | null;
  code_hint: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: ["invites"],
    queryFn: () => api.get<InviteView[]>("/invites"),
    enabled,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ttl_hours: number; hint: string }) => api.post<InviteView>("/invites", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<InviteView>(`/invites/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites"] }),
  });
}
