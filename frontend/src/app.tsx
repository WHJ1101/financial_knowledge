import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useLogout, useSession } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MarketTicker } from "@/components/MarketTicker";
import { SidebarNavigation, type SidebarNavItem } from "@/components/SidebarNavigation";
import "@/styles/tokens.css";
import "@/styles/app.css";

const LoginPage = lazy(() => import("@/pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const TodayPage = lazy(() => import("@/pages/TodayPage").then((module) => ({ default: module.TodayPage })));
const DecisionsPage = lazy(() => import("@/pages/DecisionsPage").then((module) => ({ default: module.DecisionsPage })));
const PortfolioPage = lazy(() => import("@/pages/PortfolioPage").then((module) => ({ default: module.PortfolioPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((module) => ({ default: module.KnowledgePage })));
const ReportReaderPage = lazy(() => import("@/pages/ReportReaderPage").then((module) => ({ default: module.ReportReaderPage })));
const SignalsPage = lazy(() => import("@/pages/SignalsPage").then((module) => ({ default: module.SignalsPage })));
const TasksPage = lazy(() => import("@/pages/TasksPage").then((module) => ({ default: module.TasksPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.isLoading) return <div className="boot-screen">加载中…</div>;
  if (session.isError) {
    return (
      <div className="boot-screen" role="alert">
        会话状态加载失败 <button className="text-button" onClick={() => session.refetch()}>重试</button>
      </div>
    );
  }
  if (!session.data?.authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const NAV: SidebarNavItem[] = [
  { to: "/today", label: "今日" },
  { to: "/decisions", label: "决策辩论" },
  { to: "/portfolio", label: "投资组合" },
  { to: "/knowledge", label: "知识库" },
  { to: "/signals", label: "信号源" },
  { to: "/tasks", label: "任务", superadmin: true },
  { to: "/settings", label: "设置" },
];

const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/login$/, "登录"],
  [/^\/register$/, "注册"],
  [/^\/today$/, "今日"],
  [/^\/decisions$/, "决策辩论"],
  [/^\/portfolio$/, "投资组合"],
  [/^\/knowledge$/, "知识库"],
  [/^\/reports\//, "报告阅读"],
  [/^\/signals$/, "信号源"],
  [/^\/tasks$/, "任务"],
  [/^\/settings$/, "设置"],
];

function PageTitle() {
  const location = useLocation();
  useEffect(() => {
    const page = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1];
    document.title = page ? `${page} · 投研工作台` : "投研工作台";
  }, [location.pathname]);
  return null;
}

function Shell() {
  const session = useSession();
  const logout = useLogout();
  const isSuperadmin = session.data?.user?.role === "superadmin";
  const nav = NAV.filter((n) => !n.superadmin || isSuperadmin);
  return (
    <div className="app-shell">
      <SidebarNavigation
        items={nav}
        username={session.data?.user?.username ?? "暂无"}
        logoutPending={logout.isPending}
        logoutError={logout.isError}
        onLogout={() => logout.mutate()}
      />
      <main className="app-main">
        <MarketTicker />
        <div className="app-view">
          <ErrorBoundary>
            <Suspense fallback={<div className="boot-screen">加载页面…</div>}>
              <Routes>
                <Route path="/today" element={<TodayPage />} />
                <Route path="/decisions" element={<DecisionsPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/reports/:reportId" element={<ReportReaderPage />} />
                <Route path="/signals" element={<SignalsPage />} />
                <Route path="/tasks" element={isSuperadmin ? <TasksPage /> : <Navigate to="/today" replace />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/today" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PageTitle />
        <Suspense fallback={<div className="boot-screen">加载应用…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/*" element={<Protected><Shell /></Protected>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
