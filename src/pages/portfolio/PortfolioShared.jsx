import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { actionLabel, riskLevel } from "../../lib/portfolio-analysis.js";

export function PanelHeader({ title, subtitle, children }) {
  return (
    <div class="portfolio-panel-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function SearchField({ value, suggestions, onInput, onSelect }) {
  return (
    <div class="compact-search">
      <input required placeholder="代码或名称搜索" value={value} onInput={e => onInput(e.target.value)} autocomplete="off" />
      {suggestions.length > 0 && (
        <div class="search-dropdown">
          {suggestions.map(s => (
            <div key={s.secid} class="search-dropdown-item" onClick={() => onSelect(s)}>
              <b>{s.code}</b> {s.name} <span>{s.market}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailTitle({ title, meta }) {
  return (
    <div class="detail-title">
      <h2>{title}</h2>
      <p>{meta}</p>
    </div>
  );
}

export function MiniMetric({ label, value, tone = "" }) {
  return (
    <div class={`mini-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DetailActions({ children }) {
  return <div class="detail-actions">{children}</div>;
}

export function EmptyTable({ text }) {
  return <div class="empty-table">{text}</div>;
}

export function AnalysisContent({ status, fields }) {
  if (status !== "done") return <AnalysisState status={status} />;
  const visibleFields = fields.filter(f => f.value);
  if (!visibleFields.length) return <AnalysisState status="empty" />;
  return (
    <div class="analysis-panel">
      {visibleFields.map(f => <AnalysisField key={f.label} label={f.label} text={f.value} />)}
    </div>
  );
}

export function AnalysisContentAnimated({ status, fields }) {
  if (status !== "done") return <AnalysisState status={status} />;
  const visibleFields = fields.filter(f => f.value);
  if (!visibleFields.length) return <AnalysisState status="empty" />;
  return (
    <div class="analysis-panel analysis-panel-animated" aria-live="polite">
      {visibleFields.map((f, index) => (
        <TypewriterField key={f.label} label={f.label} text={f.value} delay={index * 180} />
      ))}
    </div>
  );
}

function AnalysisState({ status }) {
  if (status === "analyzing") {
    return (
      <div class="analysis-panel analysis-panel-working" aria-live="polite">
        <div class="analysis-status-line">
          <span class="analysis-pulse" />
          <span>AI 正在整理投研要点</span>
          <span class="analysis-dots"><i /><i /><i /></span>
        </div>
        <div class="analysis-skeleton"><span /><span /><span /></div>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div class="analysis-panel analysis-panel-message failed">
        <span>分析失败，请重试或检查 LLM 配置</span>
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div class="analysis-panel analysis-panel-message">
        <span>暂无分析内容</span>
      </div>
    );
  }
  return (
    <div class="analysis-panel analysis-panel-message">
      <span>等待分析</span>
    </div>
  );
}

function AnalysisField({ label, text }) {
  return (
    <div class="analysis-field">
      <span class="analysis-label">{label}</span>
      <p class="analysis-text">{text}</p>
    </div>
  );
}

function TypewriterField({ label, text, delay = 0 }) {
  const units = useMemo(() => splitGraphemes(text), [text]);
  const [len, setLen] = useState(0);
  const [active, setActive] = useState(false);
  const rafRef = useRef(null);
  const delayRef = useRef(null);
  useEffect(() => {
    let start = 0;
    const total = units.length;
    const chunk = total > 160 ? 3 : total > 80 ? 2 : 1;
    setLen(0);
    setActive(total > 0);
    if (!total) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setLen(total);
      setActive(false);
      return;
    }
    const step = (ts) => {
      if (!start) start = ts;
      const nextLen = Math.min(total, Math.floor((ts - start) / 24) * chunk + 1);
      setLen(nextLen);
      if (nextLen < total) rafRef.current = requestAnimationFrame(step);
      else setActive(false);
    };
    delayRef.current = setTimeout(() => { rafRef.current = requestAnimationFrame(step); }, delay);
    return () => {
      if (delayRef.current) clearTimeout(delayRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [units, delay]);
  return (
    <div class={`analysis-field ${active ? "active" : "done"}`}>
      <span class="analysis-label">{label}</span>
      <p class="analysis-text">
        {units.slice(0, len).join("")}
        {active && <span class="typing-caret" aria-hidden="true" />}
      </p>
    </div>
  );
}

const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" }) : null;
function splitGraphemes(text) {
  if (!text) return [];
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), part => part.segment);
}

export function ActionChip({ text, status }) {
  const label = actionLabel(text, status);
  return <span class={`action-chip ${label === "分析中" ? "working" : ""}`}>{label}</span>;
}

export function RiskBadge({ text, status }) {
  if (status === "analyzing") return <span class="risk-badge muted">分析中</span>;
  if (status === "failed") return <span class="risk-badge high">失败</span>;
  const level = riskLevel(text);
  const label = level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
  return <span class={`risk-badge ${level}`}>{label}</span>;
}

export function StatusPill({ text }) {
  return <span class="status-pill">{text}</span>;
}
