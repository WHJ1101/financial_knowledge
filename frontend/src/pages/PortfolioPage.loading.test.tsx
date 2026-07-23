import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

const portfolioAnalysis = vi.hoisted(() => vi.fn());
const positions = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePortfolio", () => ({
  usePositions: positions,
  useAddPosition: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useAnalyzePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useWatchlist: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useAddWatchlist: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteWatchlist: () => ({ mutate: vi.fn(), isPending: false }),
  useAnalyzeWatchlist: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useMarket", () => ({
  usePortfolioAnalysis: portfolioAnalysis,
  useMarketIndices: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/components/PortfolioTrendChart", () => ({
  PortfolioTrendChart: () => null,
}));

vi.mock("@/components/PortfolioAnalysisPanel", () => ({
  PortfolioAnalysisPanel: () => null,
}));

vi.mock("@/components/PortfolioDetailPanel", () => ({
  PositionDetail: ({ holding }: { holding: { name: string } }) => <aside>{holding.name}详情</aside>,
  WatchlistDetail: () => null,
}));

vi.mock("@/components/SearchField", () => ({
  SearchField: ({ value }: { value: string }) => <input aria-label="搜索持仓" value={value} readOnly />,
}));

vi.mock("@/components/LiquidGlass", () => ({
  GlassActionLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  GlassButton: ({
    children,
    tone: _tone,
    size: _size,
    refraction: _refraction,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string; size?: string; refraction?: boolean }) => (
    <button {...props}>{children}</button>
  ),
  GlassPanel: ({ children, as: Tag = "div", ...props }: { children: React.ReactNode; as?: React.ElementType; [key: string]: unknown }) => <Tag {...props}>{children}</Tag>,
}));

import { PortfolioPage } from "@/pages/PortfolioPage";

test("实时行情仍在加载时先展示基础持仓", () => {
  positions.mockReturnValue({
    data: [
      {
        id: "position-1",
        instrument_id: "instrument-1",
        code: "301308",
        name: "江波龙",
        market: "A股",
        shares: 100,
        cost: 88,
        reason: "存储周期",
        risk: null,
        analysis_detail: {},
        analysis_status: "done",
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  portfolioAnalysis.mockReturnValue({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    refetch: vi.fn(),
  });

  render(<MemoryRouter><PortfolioPage /></MemoryRouter>);

  expect(screen.getByText("江波龙")).toBeInTheDocument();
  expect(screen.getByText("持仓已加载，正在更新实时行情…")).toBeInTheDocument();
  expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
});
