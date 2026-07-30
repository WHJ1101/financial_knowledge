import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

const createDebate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePortfolio", () => ({
  usePositions: () => ({
    data: [{ instrument_id: "instrument-1", name: "江波龙", code: "301308" }],
    isLoading: false,
  }),
  useWatchlist: () => ({ data: [], isLoading: false }),
  useAddWatchlist: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock("@/hooks/useDebates", () => ({
  useDebates: () => ({
    data: [
      { id: "bull", instrument_name: "偏多标的", instrument_code: "000001", status: "done", verdict: "偏多", created_at: "2026-07-20T10:00:00Z" },
      { id: "bear", instrument_name: "偏空标的", instrument_code: "000002", status: "done", verdict: "偏空", created_at: "2026-07-20T09:00:00Z" },
      { id: "neutral", instrument_name: "中性标的", instrument_code: "000003", status: "done", verdict: "中性", created_at: "2026-07-20T08:00:00Z" },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateDebate: () => ({ mutate: createDebate, isPending: false, error: null }),
  useCancelDebate: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useResumeDebate: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDebate: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/features/instruments/useInstruments", () => ({
  useInstrumentSearch: () => ({ data: [], isLoading: false, isError: false, isSuccess: true }),
  useResolveInstrument: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useInstrumentCoverage: () => ({ data: null }),
}));

import { DecisionsPage } from "@/pages/DecisionsPage";

test("发起辩论时提交标的、周期和关注问题", async () => {
  render(<MemoryRouter><DecisionsPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: /搜索股票、ETF、指数或基金/ }));
  await userEvent.click(screen.getByRole("button", { name: /江波龙.*301308/ }));
  await userEvent.selectOptions(screen.getByLabelText("投资周期"), "long");
  await userEvent.type(screen.getByLabelText("关注问题（可选）"), "长期竞争力如何？");
  await userEvent.click(screen.getByRole("button", { name: "发起辩论" }));
  expect(createDebate).toHaveBeenCalledWith(
    { instrument_id: "instrument-1", horizon: "long", question: "长期竞争力如何？" },
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
});

test("历史辩论使用浅色语义胶囊区分裁决", () => {
  render(<MemoryRouter><DecisionsPage /></MemoryRouter>);

  expect(screen.getByText("偏多")).toHaveClass("badge-bull", "debate-list-verdict");
  expect(screen.getByText("偏空")).toHaveClass("badge-bear", "debate-list-verdict");
  expect(screen.getByText("中性")).toHaveClass("badge-neutral", "debate-list-verdict");
});
