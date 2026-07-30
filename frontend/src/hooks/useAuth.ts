/** 会话/用户 hooks（方案 §8.3，TanStack Query）。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ensureCsrf } from "@/api/client";

export interface UserView {
  id: string;
  username: string;
  role: "superadmin" | "member";
  status: string;
  must_change_password: boolean;
  password_changed_at: string | null;
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
    // 注册接口会直接建立会话。先同步缓存，再触发后台校验，避免跳转到
    // 受保护页面时仍读到注册前的匿名状态而被送回登录页。
    onSuccess: (data) => {
      qc.setQueryData(["session"], data);
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post<{ ok: boolean; revoked_count: number; user: UserView }>("/me/password", body),
    onSuccess: (data) => {
      qc.setQueryData<SessionView>(["session"], (current) => (
        current ? { ...current, user: data.user } : current
      ));
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export interface AdminUserView {
  id: string;
  username: string;
  role: "superadmin" | "member";
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  active_session_count: number;
  must_change_password: boolean;
  password_changed_at: string | null;
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<AdminUserView[]>("/admin/users"),
    enabled,
  });
}

export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      api.patch<AdminUserView>(`/admin/users/${id}/status`, { status }),
    onSuccess: (updated) => {
      qc.setQueryData<AdminUserView[]>(["admin-users"], (current) =>
        current?.map((user) => user.id === updated.id ? updated : user));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useRevokeUserSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ revoked_count: number }>(`/admin/users/${id}/sessions/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ user: AdminUserView; one_time_password: string }>(`/admin/users/${id}/password-reset`),
    onSuccess: (result) => {
      qc.setQueryData<AdminUserView[]>(["admin-users"], (current) =>
        current?.map((user) => user.id === result.user.id ? result.user : user));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
}

export interface InviteView {
  id: string;
  code: string | null;
  code_hint: string;
  expires_at: string;
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
