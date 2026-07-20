import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PressureCard } from "@/components/PressureCard";

test("压力指标提供可聚焦的说明浮层，并保留数值语义", () => {
  render(
    <PressureCard
      theme={{
        id: "a-share-semi",
        name: "A股半导体",
        market: "A股",
        date: "2026-07-20",
        composite: 96,
        status: "放量反弹待确认",
        crossing: "up",
        series30: [],
        subScores: [{ key: "volume", label: "量比", rawText: "量比 1.41", score: 88 }],
      }}
    />,
  );

  const trigger = screen.getByRole("button", { name: "量比，量比 1.41，压力分 88" });
  const tooltip = screen.getByRole("tooltip");

  expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
  expect(tooltip).toHaveTextContent("压力分 88");
  expect(screen.getByText("放量反弹待确认")).toBeVisible();
});
