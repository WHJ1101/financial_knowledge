import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = Exclude<ThemeMode, "system">;

const THEME_STORAGE_KEY = "fk_theme";
const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];
const THEME_LABEL: Record<ThemeMode, string> = {
  system: "系统",
  light: "亮色",
  dark: "暗色",
};

function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function initialTheme(): ThemeMode {
  const bootMode = document.documentElement.dataset.themeMode;
  if (isThemeMode(bootMode)) return bootMode;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // 隐私模式可能拒绝 localStorage，继续使用系统偏好。
  }

  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

function commitTheme(mode: ThemeMode) {
  const theme = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 主题仍在当前页面生效，持久化失败不影响操作。
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    commitTheme(mode);
    if (mode !== "system" || typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => commitTheme("system");
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [mode]);

  const nextMode = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];

  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={mode}
      aria-label={`当前${THEME_LABEL[mode]}模式，切换到${THEME_LABEL[nextMode]}模式`}
      title={`当前${THEME_LABEL[mode]}模式，点击切换到${THEME_LABEL[nextMode]}模式`}
      onClick={() => setMode(nextMode)}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <span className="theme-toggle-label">{THEME_LABEL[mode]}</span>
    </button>
  );
}
