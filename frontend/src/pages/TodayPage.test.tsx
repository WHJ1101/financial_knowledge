import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useSession: () => ({ data: { user: { role: "member" } } }),
}));

vi.mock("@/hooks/useStatus", () => ({
  useStatus: () => ({
    data: {
      nowDisplay: "周三 · 2026-07-22 14:00:00",
      today: "2026-07-22",
      todayUpdates: 1,
      unreadCount: 16,
      reportCount: 42,
      llm: { configured: true },
    },
    isLoading: false,
    isSuccess: true,
    isError: false,
  }),
  useCreateResearch: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useRunDaily: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock("@/hooks/useMarket", () => ({
  usePressure: () => ({ data: [], isLoading: false, isFetching: false, isError: false }),
  useSyncPressure: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock("@/hooks/useReports", () => ({
  useReports: () => ({ data: [], isLoading: false, isError: false }),
}));

import { TodayPage } from "@/pages/TodayPage";

test("四个概览卡片提供对应的可访问跳转入口", () => {
  render(<MemoryRouter><TodayPage /></MemoryRouter>);

  expect(screen.getByRole("link", { name: /今日更新/ })).toHaveAttribute(
    "href",
    "/knowledge?filter=today&date=2026-07-22#reports",
  );
  expect(screen.getByRole("link", { name: /未读报告/ })).toHaveAttribute("href", "/knowledge?filter=unread#reports");
  expect(screen.getByRole("link", { name: /知识库总量/ })).toHaveAttribute("href", "/knowledge#reports");
  expect(screen.getByRole("link", { name: /模型已配置/ })).toHaveAttribute("href", "/settings#llm-profiles");
});
