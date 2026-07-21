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
    expect(result).toContain('data-reader-theme="light"');
    expect(result).toContain("<body><article>报告正文</article></body>");
  });

  it("injects a dark document palette when the application uses dark mode", () => {
    const result = applyReportReaderTheme("<article>报告正文</article>", "dark");

    expect(result).toContain('data-reader-theme="dark"');
    expect(result).toContain("color-scheme: dark");
    expect(result).toContain("--paper: #242019");
    expect(result).toContain("--ink: #eee7da");
  });

  it("replaces an injected reader palette when the application theme changes", () => {
    const light = applyReportReaderTheme("<article>报告正文</article>", "light");
    const dark = applyReportReaderTheme(light, "dark");

    expect(dark).toContain('data-reader-theme="dark"');
    expect(dark).not.toContain('data-reader-theme="light"');
    expect(dark.match(/data-reader-theme=/g)).toHaveLength(1);
  });

  it("does not inject the theme twice", () => {
    const once = applyReportReaderTheme("<article>报告正文</article>");

    expect(applyReportReaderTheme(once)).toBe(once);
  });
});
