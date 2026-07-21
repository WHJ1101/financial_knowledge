import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type GlassFeedbackState = "idle" | "loading" | "success" | "error";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  pointerHighlight?: boolean;
}

type GlassPanelElement = "div" | "section" | "article" | "aside" | "form";

interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  as?: GlassPanelElement;
  tone?: "panel" | "data" | "control";
  interactive?: boolean;
}

/**
 * 全站语义化玻璃面板。保留原有 panel 类作为稳定的样式与测试契约。
 */
export function GlassPanel({
  as: Element = "div",
  className,
  tone = "panel",
  interactive = false,
  ...props
}: GlassPanelProps) {
  return (
    <Element
      {...props}
      className={classes(
        "panel",
        "glass-panel",
        `glass-panel-${tone}`,
        interactive && "glass-panel-interactive",
        className,
      )}
    />
  );
}

/**
 * 轻量玻璃表面。指针高光只写 CSS 变量，不触发 React 重渲染。
 */
export function GlassSurface({
  className,
  pointerHighlight = false,
  onPointerMove,
  onPointerLeave,
  ...props
}: GlassSurfaceProps) {
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    if (!pointerHighlight || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const target = event.currentTarget;
    const { clientX, clientY } = event;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--glass-pointer-x", `${clientX - rect.left}px`);
      target.style.setProperty("--glass-pointer-y", `${clientY - rect.top}px`);
    });
  };

  const leave = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    event.currentTarget.style.removeProperty("--glass-pointer-x");
    event.currentTarget.style.removeProperty("--glass-pointer-y");
  };

  return (
    <div
      {...props}
      className={classes("glass-surface", pointerHighlight && "glass-pointer-surface", className)}
      onPointerMove={move}
      onPointerLeave={leave}
    />
  );
}

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: GlassFeedbackState;
  loadingLabel?: ReactNode;
  successLabel?: ReactNode;
  errorLabel?: ReactNode;
  tone?: "primary" | "quiet";
}

/** 统一提交状态的玻璃按钮，加载状态使用液态点阵和表面流光。 */
export function GlassButton({
  children,
  className,
  disabled,
  state = "idle",
  loadingLabel = "处理中",
  successLabel = "已完成",
  errorLabel = "请重试",
  tone = "quiet",
  type = "button",
  ...props
}: GlassButtonProps) {
  const label = state === "loading"
    ? loadingLabel
    : state === "success"
      ? successLabel
      : state === "error"
        ? errorLabel
        : children;
  const locked = state === "loading" || state === "success";

  return (
    <button
      {...props}
      type={type}
      className={classes("glass-button", `glass-button-${tone}`, className)}
      data-state={state}
      aria-busy={state === "loading" || undefined}
      disabled={disabled || locked}
    >
      <span className="glass-button-label" aria-live="polite">{label}</span>
      {state === "loading" && (
        <span className="liquid-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </button>
  );
}

export function GlassSkeleton({
  className,
  variant = "line",
}: {
  className?: string;
  variant?: "line" | "stat" | "pressure" | "report";
}) {
  return <span className={classes("glass-skeleton", `glass-skeleton-${variant}`, className)} aria-hidden="true" />;
}

export function StatusIndicator({
  label,
  tone,
}: {
  label: ReactNode;
  tone: "success" | "warning" | "loading";
}) {
  return (
    <span className="status-indicator" data-tone={tone}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
