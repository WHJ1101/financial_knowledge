import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  saveRoutes: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  settings: {
    profiles: [
      { id: "p1", name: "默认分析", provider_host: "openrouter.ai", model: "model-a", key_hint: "sk-****1111", enabled: true, is_default: true },
      { id: "p2", name: "独立裁判", provider_host: "api.deepseek.com", model: "model-b", key_hint: "sk-****2222", enabled: true, is_default: false },
    ],
    routes: [{ role: "judge", profile_id: "p2", temperature: 0.1 }],
    available_roles: ["technical", "fundamental", "macro", "sentiment", "bull", "bear", "judge", "risk"],
  },
}));

vi.mock("@/hooks/useLlmConfig", () => ({
  useLlmConfig: () => ({
    data: mocks.settings,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateLlmProfile: () => ({ mutate: mocks.create, isPending: false, error: null }),
  useUpdateLlmProfile: () => ({ mutate: mocks.update, isPending: false, error: null }),
  useDeleteLlmProfile: () => ({ mutate: mocks.remove, isPending: false, error: null }),
  useSaveLlmRoutes: () => ({ mutate: mocks.saveRoutes, isPending: false, isSuccess: false, error: null }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useSession: () => ({ data: { user: { role: "superadmin", username: "admin" } } }),
  useInvites: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateInvite: () => ({ mutate: mocks.createInvite, isPending: false, error: null }),
  useRevokeInvite: () => ({ mutate: mocks.revokeInvite, isPending: false, error: null }),
}));

import { SettingsPage } from "@/pages/SettingsPage";

beforeEach(() => {
  cleanup();
  mocks.saveRoutes.mockClear();
});

test("展示多个 Profile、八个 Agent 路由和超管邀请码入口", () => {
  render(<SettingsPage />);
  expect(screen.getByText("默认分析")).toBeInTheDocument();
  expect(screen.getByText("独立裁判")).toBeInTheDocument();
  expect(screen.getByLabelText("技术分析师")).toBeInTheDocument();
  expect(screen.getByLabelText("风险审查员")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "成员邀请码" })).toBeInTheDocument();
  expect(screen.getByText(/有效期内可重复使用/)).toBeInTheDocument();
});

test("保存角色到独立模型的路由", async () => {
  render(<SettingsPage />);
  await userEvent.selectOptions(screen.getByLabelText("技术分析师"), "p2");
  await userEvent.click(screen.getByRole("button", { name: "保存 Agent 路由" }));
  expect(mocks.saveRoutes).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ role: "technical", profile_id: "p2", temperature: 0.3 }),
    expect.objectContaining({ role: "judge", profile_id: "p2", temperature: 0.1 }),
  ]));
});
