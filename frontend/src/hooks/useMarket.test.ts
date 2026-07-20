import { expect, test } from "vitest";
import { portfolioAnalysisRefetchInterval, type PortfolioAnalysis } from "@/hooks/useMarket";

function portfolioAnalysis(statuses: string[]): PortfolioAnalysis {
  return { holdings: statuses.map((analysisStatus) => ({ analysisStatus })) } as PortfolioAnalysis;
}

test("组合中存在分析中持仓时持续轮询", () => {
  expect(portfolioAnalysisRefetchInterval(portfolioAnalysis(["done", "analyzing"]))).toBe(2000);
});

test("组合持仓全部完成后停止轮询", () => {
  expect(portfolioAnalysisRefetchInterval(portfolioAnalysis(["done", "failed"]))).toBe(false);
  expect(portfolioAnalysisRefetchInterval(portfolioAnalysis([]))).toBe(false);
  expect(portfolioAnalysisRefetchInterval(undefined)).toBe(false);
});
