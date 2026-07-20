/** 代码/名称搜索联想（移植 PortfolioShared.SearchField，方案 §11.F）。 */
import { useEffect, useId, useRef, useState } from "react";
import { searchStocks, type SearchResult } from "@/hooks/useMarket";

export function SearchField({
  value,
  onSearch,
  onPick,
  placeholder = "代码或名称搜索",
}: {
  value: string;
  onSearch: (v: string) => void;
  onPick: (r: SearchResult) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequence = useRef(0);
  const listboxId = useId();

  useEffect(() => () => {
    requestSequence.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onInput = (v: string) => {
    const requestId = ++requestSequence.current;
    onSearch(v);
    setError(null);
    setActiveIndex(-1);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rs = await searchStocks(v);
        if (requestId !== requestSequence.current) return;
        setSuggestions(rs);
        setOpen(rs.length > 0);
      } catch {
        if (requestId !== requestSequence.current) return;
        setSuggestions([]);
        setOpen(false);
        setError("证券搜索失败，请稍后重试");
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    }, 300);
  };

  const pick = (result: SearchResult) => {
    onPick(result);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const start = current < 0 ? (delta > 0 ? -1 : 0) : current;
        return (start + delta + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pick(suggestions[activeIndex]);
    }
  };

  return (
    <div className="search-field">
      <input
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {loading && <span className="search-field-note muted" role="status">搜索中…</span>}
      {error && <span className="search-field-note search-field-error" role="alert">{error}</span>}
      {open && suggestions.length > 0 && (
        <div id={listboxId} className="search-dropdown" role="listbox" aria-label="搜索建议">
          {suggestions.map((s, index) => (
            <button
              key={s.secid}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "search-dropdown-item active" : "search-dropdown-item"}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <b>{s.code}</b> {s.name} <span className="muted">{s.market}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
