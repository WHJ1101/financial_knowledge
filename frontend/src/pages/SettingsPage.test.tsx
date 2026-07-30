import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  saveRoutes: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  testSource: vi.fn(),
  testNotification: vi.fn(),
  changePassword: vi.fn(),
  updateUserStatus: vi.fn(),
  revokeUserSessions: vi.fn(),
  resetUserPassword: vi.fn(),
  settings: {
    profiles: [
      { id: "p1", name: "默认分析", provider_host: "openrouter.ai", model: "model-a", key_hint: "sk-****1111", key_status: "valid", enabled: true, is_default: true },
      { id: "p2", name: "独立裁判", provider_host: "api.deepseek.com", model: "model-b", key_hint: "sk-****2222", key_status: "valid", enabled: true, is_default: false },
      { id: "p3", name: "迁移后待修复", provider_host: "openrouter.ai", model: "model-c", key_hint: "不可用", key_status: "invalid", enabled: true, is_default: false },
    ],
    routes: [{ role: "judge", profile_id: "p2", temperature: 0.1 }],
    available_roles: ["technical", "fundamental", "macro", "sentiment", "bull", "bear", "judge", "risk"],
  },
}));

vi.mock("@/hooks/useIntegrations", () => ({
  useFeishuIntegration: () => ({
    data: {
      source: {
        configured: true,
        resource_kind: "configured",
        latest_run: {
          id: "run-1",
          status: "succeeded",
          written_count: 2,
        },
      },
      notification: {
        credentials_configured: true,
        webhook_configured: true,
        app_bot_configured: false,
        channel: "webhook",
        target_hint: "webhook@open.feishu.cn",
        latest_delivery: { status: "succeeded" },
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useTestFeishuSource: () => ({
    mutate: mocks.testSource,
    isPending: false,
    error: null,
    data: null,
  }),
  useTestFeishuNotification: () => ({
    mutate: mocks.testNotification,
    isPending: false,
    error: null,
    data: null,
  }),
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
  useSession: () => ({
    data: {
      user: {
        id: "admin-1",
        role: "superadmin",
        username: "admin",
        status: "active",
        must_change_password: false,
        password_changed_at: null,
      },
    },
  }),
  useChangePassword: () => ({ mutate: mocks.changePassword, isPending: false, error: null }),
  useAdminUsers: () => ({
    data: [
      {
        id: "admin-1",
        username: "admin",
        role: "superadmin",
        status: "active",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        last_login_at: "2026-07-29T10:00:00Z",
        active_session_count: 1,
        must_change_password: false,
        password_changed_at: null,
      },
      {
        id: "member-1",
        username: "member",
        role: "member",
        status: "active",
        created_at: "2026-07-02T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        last_login_at: null,
        active_session_count: 0,
        must_change_password: true,
        password_changed_at: "2026-07-29T09:00:00Z",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateUserStatus: () => ({ mutate: mocks.updateUserStatus, isPending: false, error: null }),
  useRevokeUserSessions: () => ({ mutate: mocks.revokeUserSessions, isPending: false, error: null }),
  useResetUserPassword: () => ({ mutate: mocks.resetUserPassword, isPending: false, error: null }),
  useInvites: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateInvite: () => ({ mutate: mocks.createInvite, isPending: false, error: null }),
  useRevokeInvite: () => ({ mutate: mocks.revokeInvite, isPending: false, error: null }),
}));

import { SettingsPage } from "@/pages/SettingsPage";

beforeEach(() => {
  cleanup();
  mocks.saveRoutes.mockClear();
  mocks.testSource.mockClear();
  mocks.testNotification.mockClear();
  mocks.updateUserStatus.mockClear();
});

test("展示多个 Profile、八个 Agent 路由和超管邀请码入口", () => {
  render(<SettingsPage />);
  expect(screen.getByText("默认分析")).toBeInTheDocument();
  expect(screen.getByText("独立裁判")).toBeInTheDocument();
  expect(screen.getByLabelText("技术分析师")).toBeInTheDocument();
  expect(screen.getByLabelText("风险审查员")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "成员邀请码" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "飞书集成" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "账户与密码" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "成员与会话" })).toBeInTheDocument();
  expect(screen.getByText(/有效期内可重复使用/)).toBeInTheDocument();
});

test("成员停用必须通过 AppDialog 二次确认", async () => {
  render(<SettingsPage />);
  const member = screen.getByText("member").closest("article");
  expect(member).not.toBeNull();
  await userEvent.click(within(member!).getByRole("button", { name: "停用" }));
  expect(screen.getByRole("dialog", { name: "停用成员" })).toBeInTheDocument();
  expect(mocks.updateUserStatus).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
  expect(mocks.updateUserStatus).toHaveBeenCalledWith(
    { id: "member-1", status: "disabled" },
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
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

test("单个 Profile 密钥失效时保留设置页并给出修复提示", () => {
  render(<SettingsPage />);
  expect(screen.getByText("迁移后待修复")).toBeInTheDocument();
  expect(screen.getByText(/密钥无法解密，请重新填写 API Key 并保存/)).toBeInTheDocument();
});

test("飞书来源检查直接执行，通知测试必须二次确认", async () => {
  render(<SettingsPage />);

  await userEvent.click(screen.getByRole("button", { name: "检查读取权限" }));
  expect(mocks.testSource).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole("button", { name: "发送测试消息" }));
  expect(screen.getByRole("dialog", { name: "确认发送真实消息" })).toBeInTheDocument();
  expect(mocks.testNotification).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "确认发送" }));
  expect(mocks.testNotification).toHaveBeenCalledTimes(1);
});
