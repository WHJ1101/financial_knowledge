import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import type { AnalysisHolding } from "@/hooks/useMarket";

vi.mock("@/hooks/useAuth", () => ({
  useSession: () => ({ data: { user: { role: "member" } } }),
}));

vi.mock("@/hooks/useMarket", () => ({
  useAssetReports: () => ({ data: [], isLoading: false, isError: false }),
  useUpsertQuoteOverride: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteQuoteOverride: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePortfolio", () => ({
  useUpdatePosition: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PositionDetail } from "@/components/PortfolioDetailPanel";

const holding: AnalysisHolding = {
  id: "p1",
  code: "024239",
  name: "华夏全球科技先锋混合(QDII)C",
  market: "基金",
  shares: 37101,
  cost: 2.911,
  price: 2.973,
  changePct: "0.5",
  quoteSource: "基金估算净值",
  marketValue: 110305,
  pnl: 2304,
  pnlPct: 2.13,
  weight: 15.6,
  risk: "若连续跌破MA20且宏观数据转弱，应重新评估。",
  reason: "【持有】短期趋势承压，基本面暴露仍集中于全球光通信与半导体。",
  analysisStatus: "done",
  analysisDetail: {
    trend: "截至2026-07-18，20日跌幅为8.5%，当前价格低于MA20。",
    fundamentals: "最新公开十大持仓包含台积电、美光科技与康宁。",
    macro: "2026年6月PMI为50.3点，制造业仍处扩张区间。",
    theme_news: "已核对2026-07-18每日市场简报中的AI基础设施主题。",
    triggers: ["重新站上MA20后复核加仓条件"],
    evidence_used: ["daily_bars 2026-07-18", "2026-07-18 每日市场简报"],
    data_gaps: ["基金基本面：缺少十大持仓单项权重"],
    generated_at: "2026-07-18T15:00:00+08:00",
    quote_snapshot: {
      price: 2.973,
      change_pct: "0.5",
      source: "基金估算净值",
      as_of: "2026-07-18T15:00:00+08:00",
    },
    position_snapshot: {
      shares: 37101,
      cost: 2.911,
      pnl_pct: 2.13,
    },
  },
};

test("持仓详情分维度展示走势、基本面、宏观、简报与证据缺口", () => {
  render(
    <MemoryRouter>
      <PositionDetail holding={holding} onAnalyze={() => undefined} onDelete={() => undefined} />
    </MemoryRouter>,
  );

  const evidence = screen.getByRole("region", { name: "持仓分析证据" });
  expect(evidence).toHaveTextContent("20日跌幅为8.5%");
  expect(evidence).toHaveTextContent("台积电、美光科技与康宁");
  expect(evidence).toHaveTextContent("2026年6月PMI为50.3点");
  expect(evidence).toHaveTextContent("2026-07-18每日市场简报");
  expect(evidence).toHaveTextContent("重新站上MA20后复核加仓条件");
  expect(evidence).toHaveTextContent("daily_bars 2026-07-18");
  expect(evidence).toHaveTextContent("缺少十大持仓单项权重");
});

test("缺少行情快照的旧分析默认停止展示为当前建议", () => {
  render(
    <MemoryRouter>
      <PositionDetail
        holding={{
          ...holding,
          reason: "【减仓】当前价格1元，盈亏比为-18.14%。",
          analysisDetail: {
            generated_at: "2026-07-01T10:00:00+08:00",
          },
        }}
        onAnalyze={() => undefined}
        onDelete={() => undefined}
      />
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("旧版分析缺少行情快照");
  expect(screen.getByText("查看旧分析（仅供追溯）")).toBeInTheDocument();
  expect(screen.queryByText("【减仓】当前价格1元，盈亏比为-18.14%。")).not.toBeInTheDocument();
});
