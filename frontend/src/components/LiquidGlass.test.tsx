import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassButton, GlassSurface, StatusIndicator } from "@/components/LiquidGlass";

describe("LiquidGlass components", () => {
  it("keeps the loading button size contract and exposes progress semantics", () => {
    const { container } = render(
      <GlassButton state="loading" loadingLabel="正在生成">生成报告</GlassButton>,
    );

    const button = screen.getByRole("button", { name: "正在生成" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".liquid-loader i")).toHaveLength(3);
  });

  it("keeps error actions available for retry", () => {
    render(<GlassButton state="error" errorLabel="生成失败，请重试">生成报告</GlassButton>);

    expect(screen.getByRole("button", { name: "生成失败，请重试" })).toBeEnabled();
  });

  it("renders semantic status text and pointer-highlight surface classes", () => {
    const { container } = render(
      <GlassSurface pointerHighlight className="stat-cell">
        <StatusIndicator tone="success" label="模型已配置" />
      </GlassSurface>,
    );

    expect(screen.getByText("模型已配置")).toBeVisible();
    expect(container.querySelector(".glass-pointer-surface.stat-cell")).toBeInTheDocument();
    expect(container.querySelector("[data-tone='success']")).toBeInTheDocument();
  });
});
