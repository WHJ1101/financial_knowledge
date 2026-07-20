import { describe, expect, it } from "vitest";
import { applyReportReaderTheme } from "@/styles/reportFrameTheme";

describe("applyReportReaderTheme", () => {
  it("injects the reader theme after existing document styles", () => {
    const result = applyReportReaderTheme("<!doctype html><html><head><style>body{color:red}</style></head><body>报告</body></html>");

    expect(result).toContain("data-reader-theme");
    expect(result.indexOf("data-reader-theme")).toBeGreaterThan(result.indexOf("body{color:red}"));
    expect(result.match(/data-reader-theme/g)).toHaveLength(1);
  });

  it("wraps an html fragment in a complete themed document", () => {
    const result = applyReportReaderTheme("<article>报告正文</article>");

    expect(result).toContain('<html lang="zh-CN">');
    expect(result).toContain("data-reader-theme");
    expect(result).toContain("<body><article>报告正文</article></body>");
  });

  it("does not inject the theme twice", () => {
    const once = applyReportReaderTheme("<article>报告正文</article>");

    expect(applyReportReaderTheme(once)).toBe(once);
  });
});
