const REPORT_READER_THEME = `<style data-reader-theme>
:root {
  --accent: #9b6817 !important;
  --ink: #211a10 !important;
  --muted: #756752 !important;
  --line: #eadfc9 !important;
  --line-soft: #f2eadb !important;
  --soft: #f7f2e8 !important;
  --paper: #fffdfa !important;
  --reader-soft: #f6ecda;
  --reader-accent-wash: #f2dfb5;
  --reader-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

body {
  background:
    radial-gradient(circle at 12% 0%, rgba(155, 104, 23, 0.11), transparent 25rem),
    var(--soft) !important;
  color: var(--ink) !important;
  font-family: "SF Pro Text", -apple-system, "PingFang SC", "Helvetica Neue", system-ui, sans-serif !important;
}

main { max-width: 1020px !important; padding: 40px 24px 68px !important; }
article {
  background: var(--paper) !important;
  border-color: var(--line) !important;
  border-radius: 10px !important;
  box-shadow: 0 2px 6px rgba(87, 61, 27, 0.05), 0 20px 54px rgba(87, 61, 27, 0.08) !important;
  animation: reader-document-in 0.58s var(--reader-ease) both;
}

h1, h2, strong { color: var(--ink); }
h1, h2 { font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", Georgia, serif; }
h1 { letter-spacing: -0.035em; font-weight: 600; }
h2 { letter-spacing: -0.018em; }
.meta, .source-meta, .section-note { color: var(--muted) !important; }
.summary {
  border-left-color: var(--accent) !important;
  background: linear-gradient(135deg, var(--reader-accent-wash), color-mix(in srgb, var(--paper) 74%, var(--reader-accent-wash))) !important;
}
.tag, .confidence {
  border-color: color-mix(in srgb, var(--accent) 22%, var(--line)) !important;
  background: color-mix(in srgb, var(--paper) 78%, var(--reader-accent-wash)) !important;
  color: var(--accent) !important;
}
.quality, .source-item { background: var(--paper) !important; border-color: var(--line) !important; }
.quality { box-shadow: 0 8px 24px rgba(87, 61, 27, 0.035); }
.source-item {
  border-radius: 8px !important;
  box-shadow: 0 8px 26px rgba(87, 61, 27, 0.035) !important;
  transition: border-color 0.24s var(--reader-ease), box-shadow 0.28s var(--reader-ease), transform 0.28s var(--reader-ease);
}
.source-top { background: linear-gradient(180deg, var(--paper), var(--reader-soft)) !important; }
.source-snippet, .source-empty { color: #493f30 !important; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: #71450b; }

@media (hover: hover) and (pointer: fine) {
  .source-item:hover {
    border-color: color-mix(in srgb, var(--accent) 38%, var(--line)) !important;
    box-shadow: 0 14px 34px rgba(87, 61, 27, 0.08) !important;
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

export function applyReportReaderTheme(html: string): string {
  if (html.includes("data-reader-theme")) return html;

  const headClose = html.match(/<\/head\s*>/i);
  if (headClose?.index != null) {
    return `${html.slice(0, headClose.index)}${REPORT_READER_THEME}${html.slice(headClose.index)}`;
  }

  const htmlOpen = html.match(/<html(?:\s[^>]*)?>/i);
  if (htmlOpen?.index != null) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, insertAt)}<head>${REPORT_READER_THEME}</head>${html.slice(insertAt)}`;
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${REPORT_READER_THEME}</head><body>${html}</body></html>`;
}
