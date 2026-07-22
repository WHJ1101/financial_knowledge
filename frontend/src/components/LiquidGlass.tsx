import {
  useEffect,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, type LinkProps, type To } from "react-router-dom";

export type GlassFeedbackState = "idle" | "loading" | "success" | "error";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  pointerHighlight?: boolean;
  to?: To;
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
  to,
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
      frame.current = null;
    });
  };

  const leave = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    event.currentTarget.style.removeProperty("--glass-pointer-x");
    event.currentTarget.style.removeProperty("--glass-pointer-y");
  };

  const surfaceProps = {
    ...props,
    className: classes("glass-surface", pointerHighlight && "glass-pointer-surface", to != null && "glass-surface-link", className),
    onPointerMove: move,
    onPointerLeave: leave,
  };

  if (to != null) return <Link to={to} {...(surfaceProps as unknown as Omit<LinkProps, "to">)} />;
  return <div {...surfaceProps} />;
}

export type GlassButtonTone = "primary" | "secondary" | "utility" | "danger" | "text";
export type GlassButtonSize = "sm" | "md" | "lg";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: GlassFeedbackState;
  loadingLabel?: ReactNode;
  successLabel?: ReactNode;
  errorLabel?: ReactNode;
  tone?: GlassButtonTone;
  size?: GlassButtonSize;
  active?: boolean;
  refraction?: boolean;
}

interface GlassActionLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href?: string;
  to?: To;
  tone?: Exclude<GlassButtonTone, "danger">;
  size?: GlassButtonSize;
}

/**
 * 小型交互表面共用的边缘位移滤镜。滤镜只挂载一次，内容层始终保持清晰。
 */
export function LiquidGlassFilterDefs() {
  return (
    <svg className="liquid-glass-filter-defs" aria-hidden="true">
      <defs>
        <filter
          id="liquid-glass-edge-refraction"
          x="-18%"
          y="-45%"
          width="136%"
          height="190%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.055"
            numOctaves="1"
            seed="17"
            result="liquidNoise"
          />
          <feGaussianBlur in="liquidNoise" stdDeviation="0.42" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </defs>
    </svg>
  );
}

/** 统一动作按钮。完整折射由一级操作显式开启，工具与文本动作保持轻量。 */
export function GlassButton({
  children,
  className,
  disabled,
  state = "idle",
  loadingLabel = "处理中",
  successLabel = "已完成",
  errorLabel = "请重试",
  tone = "secondary",
  size = "md",
  active = false,
  refraction = false,
  type = "button",
  onPointerMove,
  onPointerLeave,
  ...props
}: GlassButtonProps) {
  const frame = useRef<number | null>(null);
  const refracts = refraction && tone === "primary";
  const label = state === "loading"
    ? loadingLabel
    : state === "success"
      ? successLabel
      : state === "error"
        ? errorLabel
        : children;
  const locked = state === "loading" || state === "success";

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event);
    if (!refracts || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const target = event.currentTarget;
    const { clientX, clientY } = event;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--glass-pointer-x", `${clientX - rect.left}px`);
      target.style.setProperty("--glass-pointer-y", `${clientY - rect.top}px`);
      frame.current = null;
    });
  };

  const leave = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event);
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    event.currentTarget.style.removeProperty("--glass-pointer-x");
    event.currentTarget.style.removeProperty("--glass-pointer-y");
  };

  return (
    <button
      {...props}
      type={type}
      className={classes(
        "glass-button",
        `glass-button-${tone}`,
        `glass-button-${size}`,
        refracts && "glass-refraction-surface",
        className,
      )}
      data-state={state}
      data-active={active || undefined}
      data-refraction={refracts || undefined}
      aria-busy={state === "loading" || undefined}
      disabled={disabled || locked}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {refracts && <span className="glass-refraction-warp" aria-hidden="true" />}
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

/** 与按钮共享层级和尺寸的动作链接，用于导出与站内跳转。 */
export function GlassActionLink({
  children,
  className,
  href,
  to,
  tone = "secondary",
  size = "md",
  ...props
}: GlassActionLinkProps) {
  const actionClassName = classes(
    "glass-button",
    `glass-button-${tone}`,
    `glass-button-${size}`,
    className,
  );

  if (to != null) {
    return (
      <Link className={actionClassName} to={to} {...props}>
        <span className="glass-button-label">{children}</span>
      </Link>
    );
  }

  return (
    <a className={actionClassName} href={href} {...props}>
      <span className="glass-button-label">{children}</span>
    </a>
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
