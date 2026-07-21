import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { GlassPanel } from "@/components/LiquidGlass";
import { useLogin, useSession } from "@/hooks/useAuth";

/** 登录页（方案 §8.2）。延续原 Preact 版视觉：居中卡片 + 品牌标。 */
export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const session = useSession();
  const navigate = useNavigate();

  // 已登录时直接离开登录页（避免停在 /login，修复登录后不跳转）
  if (session.data?.authenticated) return <Navigate to="/decisions" replace />;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => navigate("/decisions", { replace: true }) },
    );
  };

  const error = login.error instanceof ApiError ? login.error.detail : login.error ? "登录失败" : null;

  return (
    <div className="login-page">
      <GlassPanel className="login-panel">
        <div className="login-brand">
          投研工作台
          <span>Financial Knowledge · 多角色辩论决策</span>
        </div>
        <p>登录以访问你的持仓、报告与决策</p>
        {session.isError && (
          <div className="login-error" role="alert">
            会话状态加载失败 <button className="text-button" onClick={() => session.refetch()}>重试</button>
          </div>
        )}
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="btn" type="submit" disabled={login.isPending || !username || !password}>
            {login.isPending ? "登录中…" : "登录"}
          </button>
        </form>
        <p className="login-foot">
          没有账号？<Link to="/register">使用管理员邀请码注册</Link>
        </p>
      </GlassPanel>
    </div>
  );
}
