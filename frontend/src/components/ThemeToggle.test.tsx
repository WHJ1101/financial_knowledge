import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";

beforeEach(() => {
  document.documentElement.dataset.themeMode = "system";
  document.documentElement.dataset.theme = "light";
  document.documentElement.style.colorScheme = "light";
  window.localStorage.clear();
});

test("按系统、亮色、暗色循环并持久化用户选择", async () => {
  render(<ThemeToggle />);

  const systemToggle = screen.getByRole("button", { name: "当前系统模式，切换到亮色模式" });
  expect(window.localStorage.getItem("fk_theme")).toBe("system");

  await userEvent.click(systemToggle);

  expect(document.documentElement.dataset.themeMode).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(window.localStorage.getItem("fk_theme")).toBe("light");

  await userEvent.click(screen.getByRole("button", { name: "当前亮色模式，切换到暗色模式" }));

  expect(document.documentElement.dataset.themeMode).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(window.localStorage.getItem("fk_theme")).toBe("dark");

  await userEvent.click(screen.getByRole("button", { name: "当前暗色模式，切换到系统模式" }));

  expect(document.documentElement.dataset.themeMode).toBe("system");
  expect(window.localStorage.getItem("fk_theme")).toBe("system");
});
