import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
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
      { invite_code: inviteCode, username, password },
      { onSuccess: () => navigate("/decisions", { replace: true }) },
    );
  };

  const error = register.error instanceof ApiError ? register.error.detail : register.error ? "注册失败" : null;
  const canSubmit = inviteCode && username.length >= 3 && password.length >= 8;

  return (
    <div className="login-page">
      <div className="login-panel panel">
        <div className="login-brand">
          投研工作台
          <span>Financial Knowledge · 邀请注册</span>
        </div>
        <p>输入管理员发放的邀请码创建账号</p>
        {session.isError && (
          <div className="login-error" role="alert">
            会话状态加载失败 <button className="text-button" onClick={() => session.refetch()}>重试</button>
          </div>
        )}
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            邀请码
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" />
          </label>
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
              autoComplete="new-password"
            />
            <span className="field-hint">至少 8 位</span>
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="btn" type="submit" disabled={register.isPending || !canSubmit}>
            {register.isPending ? "注册中…" : "注册"}
          </button>
        </form>
        <p className="login-foot">
          已有账号？<Link to="/login">返回登录</Link>
        </p>
      </div>
    </div>
  );
}
