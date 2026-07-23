import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toggleVisibility: vi.fn(),
}));

const reports = [
  {
    id: "today-unread",
    visibility: "shared" as const,
    title: "今日未读报告",
    topic: "美股",
    type: "market",
    type_label: "市场快览",
    summary: null,
    origin: "automation",
    local_date: "2026-07-22",
    tags: ["美股"],
    content_status: "ok",
    created_at: "2026-07-22T01:00:00Z",
    is_owner: true,
    starred: false,
    archived: false,
    read: false,
  },
  {
    id: "older-read",
    visibility: "shared" as const,
    title: "历史已读报告",
    topic: "A股",
    type: "market",
    type_label: "市场快览",
    summary: null,
    origin: "manual",
    local_date: "2026-07-20",
    tags: ["A股"],
    content_status: "ok",
    created_at: "2026-07-20T01:00:00Z",
    is_owner: false,
    starred: false,
    archived: false,
    read: true,
  },
];

vi.mock("@/hooks/useReports", () => ({
  useReports: () => ({ data: reports, isLoading: false, isError: false }),
  useMarkRead: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleStar: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleArchive: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReport: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleVisibility: () => ({ mutate: mocks.toggleVisibility, isPending: false }),
}));

import { KnowledgePage } from "@/pages/KnowledgePage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function renderKnowledge(initial = "/knowledge") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/knowledge" element={<><KnowledgePage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.toggleVisibility.mockClear();
  vi.restoreAllMocks();
});

test("中文输入法组合期间不改写 URL，提交候选后再同步搜索参数", () => {
  renderKnowledge();
  const input = screen.getByRole("textbox", { name: "搜索报告" });

  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: "mei" }, isComposing: true, inputType: "insertCompositionText" });

  expect(input).toHaveValue("mei");
  expect(screen.getByTestId("location")).toHaveTextContent("/knowledge");

  fireEvent.input(input, { target: { value: "美股" }, isComposing: true, inputType: "insertCompositionText" });

  expect(input).toHaveValue("美股");
  expect(screen.getByTestId("location")).toHaveTextContent("/knowledge");

  fireEvent.compositionEnd(input, { data: "美股" });
  expect(screen.getByTestId("location")).toHaveTextContent("/knowledge?q=%E7%BE%8E%E8%82%A1");
});

test("报告属主确认后可将共享报告转为私有", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderKnowledge();

  fireEvent.click(screen.getByRole("button", { name: "转为私有" }));

  expect(window.confirm).toHaveBeenCalledWith("确认将「今日未读报告」转为私有？其他用户将无法再看到该报告。");
  expect(mocks.toggleVisibility).toHaveBeenCalledWith(
    { id: "today-unread", visibility: "private" },
    expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }),
  );
});

test.each([
  ["/knowledge?filter=today&date=2026-07-22#reports", "今日未读报告", "历史已读报告"],
  ["/knowledge?filter=unread#reports", "今日未读报告", "历史已读报告"],
])("概览入口使用对应的知识库筛选：%s", (initial, visibleTitle, hiddenTitle) => {
  renderKnowledge(initial);
  expect(screen.getByRole("heading", { name: visibleTitle })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: hiddenTitle })).not.toBeInTheDocument();
  expect(document.querySelector("#reports")).toBeInTheDocument();
});
