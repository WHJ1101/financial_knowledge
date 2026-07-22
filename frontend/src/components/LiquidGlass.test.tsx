import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GlassButton,
  GlassActionLink,
  GlassPanel,
  GlassSurface,
  LiquidGlassFilterDefs,
  StatusIndicator,
} from "@/components/LiquidGlass";

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

  it("adds edge refraction only to surfaces that request it", () => {
    const { container } = render(
      <>
        <LiquidGlassFilterDefs />
        <GlassButton refraction tone="primary">生成报告</GlassButton>
        <GlassButton>普通操作</GlassButton>
      </>,
    );

    expect(container.querySelector("#liquid-glass-edge-refraction")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成报告" })).toHaveAttribute("data-refraction", "true");
    expect(container.querySelectorAll(".glass-refraction-warp")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "普通操作" })).not.toHaveAttribute("data-refraction");
  });

  it("keeps refraction exclusive to primary actions and shares variants with action links", () => {
    const { container } = render(
      <>
        <GlassButton tone="utility" refraction active size="sm">标星</GlassButton>
        <GlassActionLink tone="utility" size="sm" href="/export.csv">导出</GlassActionLink>
      </>,
    );

    const utility = screen.getByRole("button", { name: "标星" });
    expect(utility).toHaveClass("glass-button-utility", "glass-button-sm");
    expect(utility).toHaveAttribute("data-active", "true");
    expect(utility).not.toHaveAttribute("data-refraction");
    expect(container.querySelector(".glass-refraction-warp")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "导出" })).toHaveClass("glass-button-utility", "glass-button-sm");
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

  it("renders one semantic panel contract across page-specific containers", () => {
    const { container } = render(
      <GlassPanel as="article" tone="data" interactive className="report-card">
        报告
      </GlassPanel>,
    );

    const panel = container.querySelector("article.report-card");
    expect(panel).toHaveClass("panel", "glass-panel", "glass-panel-data", "glass-panel-interactive");
  });
});
