import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

const { searchStocks } = vi.hoisted(() => ({ searchStocks: vi.fn() }));

vi.mock("@/hooks/useMarket", () => ({ searchStocks }));

import { SearchField } from "@/components/SearchField";

test("支持方向键高亮并用 Enter 选择联想结果", async () => {
  const onPick = vi.fn();
  searchStocks.mockResolvedValueOnce([
    { code: "603986", name: "兆易创新", market: "沪市主板", secid: "1.603986" },
    { code: "301308", name: "江波龙", market: "创业板", secid: "0.301308" },
  ]);
  render(<SearchField value="" onSearch={() => undefined} onPick={onPick} />);

  const input = screen.getByRole("combobox", { name: "代码或名称搜索" });
  await userEvent.type(input, "兆易");
  await screen.findByRole("listbox", { name: "搜索建议" });
  await userEvent.keyboard("{ArrowDown}{Enter}");

  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ secid: "1.603986" }));
});

test("搜索失败时显示明确错误", async () => {
  searchStocks.mockRejectedValueOnce(new Error("provider down"));
  render(<SearchField value="" onSearch={() => undefined} onPick={() => undefined} />);

  await userEvent.type(screen.getByRole("combobox", { name: "代码或名称搜索" }), "兆易");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("证券搜索失败"));
});
