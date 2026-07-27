export type ReportReaderTheme = "light" | "dark";

const READER_PALETTES = {
  light: {
    accent: "#9b6817",
    accentHover: "#71450b",
    ink: "#211a10",
    muted: "#756752",
    line: "#eadfc9",
    lineSoft: "#f2eadb",
    soft: "#f7f2e8",
    paper: "#fffdfa",
    paperDeep: "#fbf7ef",
    readerSoft: "#f6ecda",
    accentWash: "#f2dfb5",
    snippet: "#493f30",
    code: "#f4ecde",
    bodyGlow: "rgba(155, 104, 23, 0.11)",
    shadowSoft: "rgba(87, 61, 27, 0.035)",
    shadowStrong: "rgba(87, 61, 27, 0.08)",
    selection: "rgba(155, 104, 23, 0.2)",
  },
  dark: {
    accent: "#c49a57",
    accentHover: "#dfc18c",
    ink: "#eee7da",
    muted: "#b8ad9d",
    line: "#4b3d2b",
    lineSoft: "#342c23",
    soft: "#17140f",
    paper: "#242019",
    paperDeep: "#201c16",
    readerSoft: "#2d271f",
    accentWash: "#3b2e1c",
    snippet: "#d0c5b5",
    code: "#2d271f",
    bodyGlow: "rgba(196, 154, 87, 0.09)",
    shadowSoft: "rgba(0, 0, 0, 0.18)",
    shadowStrong: "rgba(0, 0, 0, 0.34)",
    selection: "rgba(196, 154, 87, 0.28)",
  },
} as const;

const READER_THEME_PATTERN = /<style data-reader-theme(?:="(?:light|dark)")?>[\s\S]*?<\/style>/i;

function createReportReaderTheme(theme: ReportReaderTheme): string {
  const palette = READER_PALETTES[theme];
  return `<style data-reader-theme="${theme}">
:root {
  color-scheme: ${theme};
  --reader-accent: ${palette.accent};
  --reader-text: ${palette.ink};
  --reader-muted: ${palette.muted};
  --reader-line: ${palette.line};
  --reader-line-soft: ${palette.lineSoft};
  --reader-background: ${palette.soft};
  --reader-surface: ${palette.paper};
  --reader-surface-deep: ${palette.paperDeep};
  --reader-soft: ${palette.readerSoft};
  --reader-accent-wash: ${palette.accentWash};
  --reader-snippet: ${palette.snippet};
  --reader-code: ${palette.code};
  --reader-body-glow: ${palette.bodyGlow};
  --reader-shadow-soft: ${palette.shadowSoft};
  --reader-shadow-strong: ${palette.shadowStrong};
  --reader-selection: ${palette.selection};
  --reader-accent-hover: ${palette.accentHover};
  --reader-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

html {
  color-scheme: ${theme};
  background: var(--reader-background) !important;
}

body {
  background:
    radial-gradient(circle at 12% 0%, var(--reader-body-glow), transparent 25rem),
    var(--reader-background) !important;
  color: var(--reader-text) !important;
  font-family: "SF Pro Text", -apple-system, "PingFang SC", "Helvetica Neue", system-ui, sans-serif !important;
}

main { max-width: 1020px !important; padding: 40px 24px 68px !important; }
article {
  color: var(--reader-text) !important;
  background: var(--reader-surface) !important;
  border-color: var(--reader-line) !important;
  border-radius: 10px !important;
  box-shadow: 0 2px 6px var(--reader-shadow-soft), 0 20px 54px var(--reader-shadow-strong) !important;
  animation: reader-document-in 0.58s var(--reader-ease) both;
}
article article {
  background: var(--reader-surface-deep) !important;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--reader-accent) 8%, transparent) !important;
}

.hero, .report-hero, .header-card,
.card, .panel, .box, .content-card, .report-card, .section-card,
.kpi, .metric, .stat, .quality, .source-item,
.conclusion, .signal, .tbl, .table-wrap,
[style*="background:#fff" i],
[style*="background: #fff" i],
[style*="background:#ffffff" i],
[style*="background: #ffffff" i],
[style*="background:white" i],
[style*="background: white" i],
[style*="background-color:#fff" i],
[style*="background-color: #fff" i],
[style*="background-color:#ffffff" i],
[style*="background-color: #ffffff" i],
[style*="background-color:white" i],
[style*="background-color: white" i],
[style*="background: rgb(255" i],
[style*="background-color: rgb(255" i] {
  color: var(--reader-text) !important;
  background: var(--reader-surface) !important;
  border-color: var(--reader-line) !important;
}

.note, .callout, .alert, .insight, .highlight, .summary, blockquote {
  color: var(--reader-text) !important;
  background: var(--reader-soft) !important;
  border-color: var(--reader-line) !important;
}

.meta > span, .chip, .pill, .badge, .tag, .confidence {
  color: var(--reader-muted) !important;
  background: color-mix(in srgb, var(--reader-surface) 82%, var(--reader-accent-wash)) !important;
  border-color: var(--reader-line) !important;
}

.kpi span, .metric span, .stat span,
.kpi .l, .kpi .label, .metric .l, .metric .label, .stat .l, .stat .label,
.meta, .source-meta, .section-note {
  color: var(--reader-muted) !important;
}

.kpi .v, .kpi .value, .metric .v, .metric .value, .stat .v, .stat .value,
.eyebrow, .kicker, .overline {
  color: var(--reader-accent) !important;
}

.table-wrap, .tbl {
  background: var(--reader-surface-deep) !important;
  border-color: var(--reader-line) !important;
}
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--reader-surface) 92%, var(--reader-soft)) !important; }

h1, h2, h3, h4, h5, h6, strong, b { color: var(--reader-text) !important; }
h1, h2, h3 { font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", Georgia, serif; }
h1 { letter-spacing: -0.035em; font-weight: 600; }
h2 { letter-spacing: -0.018em; }
p, li, td, th, blockquote { color: var(--reader-text) !important; }
hr { border-color: var(--reader-line) !important; }
blockquote {
  border-color: var(--reader-accent) !important;
  background: var(--reader-soft) !important;
}
pre, code {
  color: var(--reader-text) !important;
  background: var(--reader-code) !important;
  border-color: var(--reader-line) !important;
}
table, th, td { border-color: var(--reader-line) !important; }
th { background: var(--reader-soft) !important; }
::selection { color: var(--reader-text); background: var(--reader-selection); }

.summary {
  border-left-color: var(--reader-accent) !important;
  background: linear-gradient(135deg, var(--reader-accent-wash), color-mix(in srgb, var(--reader-surface) 74%, var(--reader-accent-wash))) !important;
}
.tag, .confidence {
  border-color: color-mix(in srgb, var(--reader-accent) 22%, var(--reader-line)) !important;
  background: color-mix(in srgb, var(--reader-surface) 78%, var(--reader-accent-wash)) !important;
  color: var(--reader-accent) !important;
}
.quality, .source-item { background: var(--reader-surface) !important; border-color: var(--reader-line) !important; }
.quality { box-shadow: 0 8px 24px var(--reader-shadow-soft); }
.source-item {
  border-radius: 8px !important;
  box-shadow: 0 8px 26px var(--reader-shadow-soft) !important;
  transition: border-color 0.24s var(--reader-ease), box-shadow 0.28s var(--reader-ease), transform 0.28s var(--reader-ease);
}
.source-top { background: linear-gradient(180deg, var(--reader-surface), var(--reader-soft)) !important; }
.source-snippet, .source-empty { color: var(--reader-snippet) !important; }
a { color: var(--reader-accent) !important; text-underline-offset: 3px; }
a:hover { color: var(--reader-accent-hover) !important; }

@media (hover: hover) and (pointer: fine) {
  .source-item:hover {
    border-color: color-mix(in srgb, var(--reader-accent) 38%, var(--reader-line)) !important;
    box-shadow: 0 14px 34px var(--reader-shadow-strong) !important;
    transform: translateY(-1px);
  }
}

@keyframes reader-document-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 640px) {
  main { padding: 16px 10px 36px !important; }
  article { padding: 24px 18px !important; border-radius: 8px !important; }
  h1 { font-size: clamp(28px, 10vw, 38px) !important; }
}

@media (prefers-reduced-motion: reduce) {
  article { animation: none; }
  .source-item { transition: none; }
  .source-item:hover { transform: none; }
}
</style>`;
}

export function applyReportReaderTheme(html: string, theme: ReportReaderTheme = "light"): string {
  const readerTheme = createReportReaderTheme(theme);
  const existingTheme = html.match(READER_THEME_PATTERN)?.[0];
  if (existingTheme) {
    if (existingTheme.includes(`data-reader-theme="${theme}"`)) return html;
    return html.replace(READER_THEME_PATTERN, readerTheme);
  }

  const headClose = html.match(/<\/head\s*>/i);
  if (headClose?.index != null) {
    return `${html.slice(0, headClose.index)}${readerTheme}${html.slice(headClose.index)}`;
  }

  const htmlOpen = html.match(/<html(?:\s[^>]*)?>/i);
  if (htmlOpen?.index != null) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, insertAt)}<head>${readerTheme}</head>${html.slice(insertAt)}`;
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${readerTheme}</head><body>${html}</body></html>`;
}
