import { useState, useEffect } from "preact/hooks";
import { Layout } from "./components/Layout.jsx";
import { Today } from "./pages/Today.jsx";
import { Knowledge } from "./pages/Knowledge.jsx";
import { Portfolio } from "./pages/Portfolio.jsx";
import { Decisions } from "./pages/Decisions.jsx";
import { Tasks } from "./pages/Tasks.jsx";
import { Settings } from "./pages/Settings.jsx";
import { ReportReader } from "./pages/ReportReader.jsx";
import { refresh, loadMarket } from "./store.js";
import { get, post } from "./api.js";

export function App() {
  const [route, setRoute] = useState(location.hash || "#today");
  const [auth, setAuth] = useState({ loading: true, authenticated: false, authRequired: true, configured: true });

  useEffect(() => {
    const onChange = () => setRoute(location.hash || "#today");
    window.addEventListener("hashchange", onChange);
    const timer = setInterval(() => loadMarket(), 60000);
    return () => { window.removeEventListener("hashchange", onChange); clearInterval(timer); };
  }, []);

  useEffect(() => {
    get("/api/auth/session")
      .then((session) => setAuth({ ...session, loading: false }))
      .catch(() => setAuth({ loading: false, authenticated: false, authRequired: true, configured: true }));
  }, []);

  useEffect(() => {
    if (!auth.loading && auth.authenticated && !route.startsWith("#report/")) refresh();
  }, [route, auth.loading, auth.authenticated]);

  const handleLogin = async (credentials) => {
    await post("/api/auth/login", credentials);
    const session = await get("/api/auth/session");
    setAuth({ ...session, loading: false });
    await refresh();
  };

  const handleLogout = async () => {
    await post("/api/auth/logout", {});
    setAuth({ loading: false, authenticated: false, authRequired: true, configured: true });
  };

  if (auth.loading) return <div class="boot-screen">加载中...</div>;
  if (auth.authRequired && !auth.authenticated) return <LoginPage configured={auth.configured} onLogin={handleLogin} />;

  const page = () => {
    if (route.startsWith("#report/")) return <ReportReader id={decodeURIComponent(route.replace("#report/", ""))} />;
    switch (route) {
      case "#knowledge": return <Knowledge />;
      case "#portfolio": return <Portfolio />;
      case "#decisions": return <Decisions />;
      case "#tasks": return <Tasks />;
      case "#settings": return <Settings />;
      default: return <Today />;
    }
  };

  return <Layout route={route} auth={auth} onLogout={handleLogout}>{page()}</Layout>;
}

function LoginPage({ configured, onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin({ username, password });
    } catch (err) {
      setError(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="login-page">
      <section class="login-panel">
        <div class="login-brand">
          <img src="/brand-icon.png" alt="" />
          <div>
            <strong>投研助手</strong>
            <span>私有知识库</span>
          </div>
        </div>
        <h1>登录工作台</h1>
        <p>访问报告、持仓和自动化任务前需要验证身份。</p>
        {!configured ? (
          <div class="login-error">服务端尚未配置登录密码，请先设置环境变量。</div>
        ) : (
          <form class="login-form" onSubmit={submit}>
            <label>
              <span>用户名</span>
              <input value={username} onInput={e => setUsername(e.target.value)} autocomplete="username" />
            </label>
            <label>
              <span>密码</span>
              <input type="password" value={password} onInput={e => setPassword(e.target.value)} autocomplete="current-password" />
            </label>
            {error && <div class="login-error">{error}</div>}
            <button type="submit" disabled={busy}>{busy ? "登录中..." : "登录"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
