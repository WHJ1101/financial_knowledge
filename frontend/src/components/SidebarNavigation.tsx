import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { NavLink, useLocation } from "react-router-dom";

export interface SidebarNavItem {
  to: string;
  label: string;
  superadmin?: boolean;
}

interface IndicatorBox {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export function SidebarNavigation({
  items,
  username,
  logoutPending,
  logoutError,
  onLogout,
}: {
  items: SidebarNavItem[];
  username: string;
  logoutPending: boolean;
  logoutError: boolean;
  onLogout: () => void;
}) {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<IndicatorBox>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false,
  });

  useLayoutEffect(() => {
    const update = () => {
      const active = navRef.current?.querySelector<HTMLElement>(".nav-item.active");
      if (!active) {
        setIndicator((current) => ({ ...current, visible: false }));
        return;
      }
      setIndicator({
        x: active.offsetLeft,
        y: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        visible: true,
      });
    };

    update();
    const observer = typeof ResizeObserver === "undefined" || !navRef.current
      ? null
      : new ResizeObserver(update);
    if (observer && navRef.current) observer.observe(navRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [items.length, location.pathname]);

  const indicatorStyle = {
    width: indicator.width,
    height: indicator.height,
    opacity: indicator.visible ? 1 : 0,
    "--nav-pill-x": `${indicator.x}px`,
    "--nav-pill-y": `${indicator.y}px`,
  } as CSSProperties;

  return (
    <nav ref={navRef} className="sidebar" aria-label="主导航">
      <div className="brand">
        投研工作台
        <span>{username}</span>
      </div>
      <span className="nav-active-pill" style={indicatorStyle} aria-hidden="true" />
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
        >
          <span className="nav-label">{item.label}</span>
        </NavLink>
      ))}
      <button
        className="nav-item nav-logout"
        onClick={onLogout}
        disabled={logoutPending}
        aria-busy={logoutPending || undefined}
      >
        <span className="nav-label">{logoutPending ? "退出中…" : "退出登录"}</span>
      </button>
      {logoutError && <span className="nav-error" role="alert">退出失败，请重试</span>}
    </nav>
  );
}
