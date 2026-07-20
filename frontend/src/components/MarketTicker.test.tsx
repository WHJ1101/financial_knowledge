import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: {
    data: { indices: [], updatedAt: null, attemptedAt: "2026-07-17T00:00:00Z", status: "empty" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/useMarket", () => ({
  useMarketSnapshot: () => mocks.snapshot,
  useMarketSessions: () => ({ data: [] }),
}));

import { MarketTicker } from "@/components/MarketTicker";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前位置">{`${location.pathname}${location.search}`}</output>;
}

beforeEach(() => {
  mocks.snapshot.data = {
    indices: [],
    updatedAt: null,
    attemptedAt: "2026-07-17T00:00:00Z",
    status: "empty",
  };
  mocks.snapshot.isLoading = false;
  mocks.snapshot.isError = false;
  mocks.snapshot.refetch.mockClear();
});

test("全局搜索按 Enter 跳转并编码查询词", async () => {
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <MarketTicker />
      <LocationProbe />
    </MemoryRouter>,
  );

  const input = screen.getByRole("textbox", { name: "全局搜索报告" });
  await userEvent.type(input, "HBM 先进封装{Enter}");

  expect(screen.getByRole("status", { name: "当前位置" })).toHaveTextContent(
    "/knowledge?q=HBM%20%E5%85%88%E8%BF%9B%E5%B0%81%E8%A3%85",
  );
  expect(input).toHaveValue("");
});

test("行情请求已完成但无数据时不再显示加载中", () => {
  render(<MemoryRouter><MarketTicker /></MemoryRouter>);
  expect(screen.getByText("暂无行情数据")).toBeInTheDocument();
  expect(screen.queryByText("行情加载中…")).not.toBeInTheDocument();
});

test("后端首次行情刷新失败时显示不可用", () => {
  mocks.snapshot.data = { ...mocks.snapshot.data, status: "unavailable" };
  render(<MemoryRouter><MarketTicker /></MemoryRouter>);
  expect(screen.getByText("行情暂不可用")).toBeInTheDocument();
});

test("行情 HTTP 请求失败时可手动重试", async () => {
  mocks.snapshot.isError = true;
  render(<MemoryRouter><MarketTicker /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "行情加载失败" }));
  expect(mocks.snapshot.refetch).toHaveBeenCalledOnce();
});
