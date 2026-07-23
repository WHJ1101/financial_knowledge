import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const { registerMutate } = vi.hoisted(() => ({ registerMutate: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({
  useSession: () => ({ data: { authenticated: false } }),
  useLogin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRegister: () => ({ mutate: registerMutate, isPending: false, error: null }),
}));

import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";

beforeEach(() => registerMutate.mockReset());

function AuthRoutes({ initial }: { initial: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Routes>
    </MemoryRouter>
  );
}

test("登录页可进入邀请注册页", async () => {
  render(<AuthRoutes initial="/login" />);
  await userEvent.click(screen.getByRole("link", { name: "使用管理员邀请码注册" }));
  expect(screen.getByText("输入管理员发放的邀请码创建账号")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "邀请码" })).toBeInTheDocument();
  expect(screen.getByText("邀请码在有效期内可重复使用")).toBeInTheDocument();
});

test("注册页可返回登录页", async () => {
  render(<AuthRoutes initial="/register" />);
  await userEvent.click(screen.getByRole("link", { name: "返回登录" }));
  expect(screen.getByText("登录以访问你的持仓、报告与决策")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "用户名" })).toBeInTheDocument();
});

test("注册必须填写邀请码并提交清理后的账号信息", async () => {
  render(<AuthRoutes initial="/register" />);

  const inviteInput = screen.getByRole("textbox", { name: "邀请码" });
  const usernameInput = screen.getByRole("textbox", { name: "用户名" });
  const passwordInput = screen.getByLabelText("密码");
  expect(inviteInput).toBeRequired();
  expect(usernameInput).toHaveAttribute("minlength", "3");
  expect(passwordInput).toHaveAttribute("minlength", "8");

  await userEvent.type(inviteInput, "  invite-token  ");
  await userEvent.type(usernameInput, "  member  ");
  await userEvent.type(passwordInput, "member-pass-123");
  await userEvent.click(screen.getByRole("button", { name: "注册" }));

  expect(registerMutate).toHaveBeenCalledWith(
    { invite_code: "invite-token", username: "member", password: "member-pass-123" },
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
});
