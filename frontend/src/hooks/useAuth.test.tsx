import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { post: vi.fn() },
  ensureCsrf: vi.fn(),
}));

import { api, ensureCsrf } from "@/api/client";
import { useRegister } from "@/hooks/useAuth";

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(ensureCsrf).mockReset();
});

test("注册成功后立即把已登录会话写入缓存", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = {
    authenticated: true,
    user: { username: "member", role: "member" as const, status: "active" },
  };
  vi.mocked(ensureCsrf).mockResolvedValue();
  vi.mocked(api.post).mockResolvedValue(session);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useRegister(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({
      invite_code: "invite-token",
      username: "member",
      password: "member-pass-123",
    });
  });

  expect(queryClient.getQueryData(["session"])).toEqual(session);
});
