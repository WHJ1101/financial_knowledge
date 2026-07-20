import { expect, test } from "vitest";
import { formatChangePct } from "@/pages/PortfolioPage";

test("指数涨跌幅只为数值补百分号", () => {
  expect(formatChangePct("-1.85")).toBe("-1.85%");
  expect(formatChangePct("+0.42%")).toBe("+0.42%");
  expect(formatChangePct("待接入")).toBe("待接入");
  expect(formatChangePct(null)).toBe("暂无");
});
