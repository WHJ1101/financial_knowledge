import { expect, test } from "vitest";
import { debateListRefetchInterval, type DebateView } from "@/hooks/useDebates";

function debate(status: DebateView["status"]): DebateView {
  return { status } as DebateView;
}

test("历史列表存在排队或运行任务时持续轮询", () => {
  expect(debateListRefetchInterval([debate("done"), debate("queued")])).toBe(2000);
  expect(debateListRefetchInterval([debate("running")])).toBe(2000);
});

test("历史列表全部进入终态后停止轮询", () => {
  expect(debateListRefetchInterval([debate("done"), debate("failed"), debate("canceled")])).toBe(false);
  expect(debateListRefetchInterval([])).toBe(false);
  expect(debateListRefetchInterval(undefined)).toBe(false);
});
