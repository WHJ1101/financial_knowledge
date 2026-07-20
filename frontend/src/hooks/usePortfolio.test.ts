import { expect, test } from "vitest";
import { analysisListRefetchInterval, type PositionView } from "@/hooks/usePortfolio";

function position(analysisStatus: string): PositionView {
  return { analysis_status: analysisStatus } as PositionView;
}

test("列表存在分析中任务时持续轮询", () => {
  expect(analysisListRefetchInterval([position("done"), position("analyzing")])).toBe(2000);
});

test("列表没有分析中任务时停止轮询", () => {
  expect(analysisListRefetchInterval([position("done"), position("failed")])).toBe(false);
  expect(analysisListRefetchInterval([])).toBe(false);
  expect(analysisListRefetchInterval(undefined)).toBe(false);
});
