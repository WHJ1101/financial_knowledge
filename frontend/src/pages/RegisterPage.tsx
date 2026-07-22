import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { GlassButton, GlassPanel } from "@/components/LiquidGlass";
import { useRegister, useSession } from "@/hooks/useAuth";

/** 注册页（方案 §8.2/§9.2）：邀请码 + 用户名 + 密码，仅凭有效邀请码可注册。 */
export function RegisterPage() {
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const register = useRegister();
  const session = useSession();
  const navigate = useNavigate();

  if (session.data?.authenticated) return <Navigate to="/decisions" replace />;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate(
      { invite_code: inviteCode.trim(), username: username.trim(), password },
      { onSuccess: () => navigate("/decisions", { replace: true }) },
    );
  };

  const error = register.error instanceof ApiError ? register.error.detail : register.error ? "注册失败" : null;
  const canSubmit = inviteCode.trim().length > 0 && username.trim().length >= 3 && password.length >= 8;

  return (
    <div className="login-page">
      <GlassPanel className="login-panel">
        <div className="login-brand">
          投研工作台
          <span>Financial Knowledge · 邀请注册</span>
        </div>
        <p>输入管理员发放的邀请码创建账号</p>
        {session.isError && (
          <div className="login-error" role="alert">
            会话状态加载失败 <GlassButton tone="text" size="sm" onClick={() => session.refetch()}>重试</GlassButton>
          </div>
        )}
        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-field">
            <label htmlFor="register-invite">邀请码</label>
            <input
              id="register-invite"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="register-invite-hint"
              required
            />
            <span id="register-invite-hint" className="field-hint">邀请码由管理员生成，使用一次后失效</span>
          </div>
          <div className="login-field">
            <label htmlFor="register-username">用户名</label>
            <input
              id="register-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              minLength={3}
              maxLength={64}
              aria-describedby="register-username-hint"
              required
            />
            <span id="register-username-hint" className="field-hint">3–64 位</span>
          </div>
          <div className="login-field">
            <label htmlFor="register-password">密码</label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              aria-describedby="register-password-hint"
              required
            />
            <span id="register-password-hint" className="field-hint">至少 8 位</span>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <GlassButton tone="primary" size="lg" refraction type="submit" disabled={register.isPending || !canSubmit}>
            {register.isPending ? "注册中…" : "注册"}
          </GlassButton>
        </form>
        <p className="login-foot">
          已有账号？<Link to="/login">返回登录</Link>
        </p>
      </GlassPanel>
    </div>
  );
}
