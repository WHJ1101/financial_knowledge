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

  it("normalizes common imported report surfaces and hard-coded white backgrounds", () => {
    const source = [
      "<!doctype html><html><head>",
      "<style>.card{background:#fff}.kpi{background:white}</style>",
      "</head><body><main><section class=\"card\">结论</section>",
      "<div class=\"kpi\" style=\"background-color: #ffffff\">指标</div>",
      "<img src=\"chart.png\" alt=\"图表\"></main></body></html>",
    ].join("");
    const result = applyReportReaderTheme(source, "dark");

    expect(result).toContain(".card, .panel, .box");
    expect(result).toContain('[style*="background-color: #ffffff" i]');
    expect(result).toContain("background: var(--paper) !important");
    expect(result.indexOf("data-reader-theme")).toBeGreaterThan(result.indexOf(".card{background:#fff}"));
    expect(result).not.toContain("img { background: var(--paper) !important");
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
