"""每日市场简报流水线（移植 lib/dailyMarketBriefingPipeline.js，方案 §11.2）。

采集过去 24h：指数行情 + 持仓行情 + 多源财经快讯 → 规整/去重/重要性排序 →
组装证据面 + 摘要/核心观察/跟踪清单/风险/下一步 + 数据质量。

纯函数（窗口/评分/排序/去重/规整/文案）可 fixture 测试；抓取（指数/持仓/快讯）为 I/O。
新闻源：东财快讯（默认）+ 可选 JSON URL；gdelt/alphavantage 迁移时保留开关，默认关闭以免测试打外网。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

_TZ = ZoneInfo("Asia/Shanghai")
DAY = timedelta(days=1)
MIN_NEWS = 30
MAX_NEWS = 50
DISPLAY_NEWS = 20

_NEWS_RULES: list[tuple[int, re.Pattern[str]]] = [
    (
        36,
        re.compile(
            r"央行|人民银行|降准|降息|逆回购|MLF|LPR|liquidity|central bank|Fed|Federal Reserve|rate cut|rate hike",
            re.I,
        ),
    ),  # noqa: E501
    (30, re.compile(r"证监会|交易所|监管|IPO|减持|回购|并购|重组|退市|regulator|SEC|policy|tariff|sanction", re.I)),
    (
        28,
        re.compile(
            r"AI|人工智能|算力|芯片|半导体|英伟达|NVIDIA|华为|Ascend|HBM|数据中心|semiconductor|datacenter", re.I
        ),
    ),  # noqa: E501
    (24, re.compile(r"A股|港股|美股|创业板|科创|沪深|纳指|标普|恒生|ETF|北向|南向|stock|market|Nasdaq|S&P", re.I)),
    (20, re.compile(r"财报|业绩|订单|目标价|评级|召回|专利|earnings|guidance|upgrade|downgrade|recall", re.I)),
    (-8, re.compile(r"人事变动|取得\d*项发明专利证书|日内涨幅|抹去日内")),
]


@dataclass
class NewsItem:
    id: str
    title: str
    provider: str
    published_at: str
    summary: str = ""
    source: str = ""
    url: str = ""
    hot_score: float = 0.0
    relevance_score: float = 0.0
    importance_score: float = 0.0


@dataclass
class Window:
    start: datetime
    end: datetime
    timezone: str = "Asia/Shanghai"


@dataclass
class CollectResult:
    ok: bool
    rows: list[dict[str, Any]] = field(default_factory=list)
    source: str = ""
    error: str = ""
    note: str = ""


# ---- 纯函数（窗口/日期/评分/排序/去重/规整），fixture 测试 ----


def build_news_window(now: datetime | None = None) -> Window:
    end = now or datetime.now(UTC)
    return Window(start=end - DAY, end=end, timezone="Asia/Shanghai")


def _fmt_local(dt: datetime) -> str:
    return dt.astimezone(_TZ).strftime("%Y-%m-%d %H:%M:%S")


def _format_window(window: Window) -> str:
    return f"{_fmt_local(window.start)} 至 {_fmt_local(window.end)}"


def _first_text(*values: Any) -> str:
    for v in values:
        text = str(v if v is not None else "").strip()
        if text:
            return text
    return ""


def _to_finite(value: Any) -> float:
    try:
        n = float(value)
    except (ValueError, TypeError):
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


def normalize_news_date(value: Any) -> str:
    """多格式发布时间 → ISO8601 UTC。14 位数字按北京时间；YYYY-MM-DD HH:MM 按 +08:00。"""
    text = str(value or "").strip()
    if not text:
        return ""
    if re.match(r"^\d{14}$", text):
        try:
            dt = datetime(
                int(text[0:4]),
                int(text[4:6]),
                int(text[6:8]),
                int(text[8:10]),
                int(text[10:12]),
                int(text[12:14]),
                tzinfo=_TZ,
            )
            return dt.astimezone(UTC).isoformat()
        except ValueError:
            return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}", text):
        try:
            dt = datetime.fromisoformat(text.replace(" ", "T")).replace(tzinfo=_TZ)
            return dt.astimezone(UTC).isoformat()
        except ValueError:
            return ""
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(UTC).isoformat()
    except ValueError:
        return ""


def expand_records(data: Any) -> list[Any]:
    if not data:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "records", "data", "list", "fastNewsList"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return [data]


def normalize_news_items(records: Any, provider: str) -> list[NewsItem]:
    out: list[NewsItem] = []
    for i, rec in enumerate(expand_records(records)):
        if not isinstance(rec, dict):
            continue
        title = _first_text(
            rec.get("title"), rec.get("name"), rec.get("headline"), rec.get("Title"), rec.get("titleShow")
        )
        if not title:
            continue
        published = normalize_news_date(
            _first_text(
                rec.get("publishedAt"),
                rec.get("publishTime"),
                rec.get("showTime"),
                rec.get("datetime"),
                rec.get("seendate"),
                rec.get("time"),
                rec.get("createdAt"),
                rec.get("NewsTime"),
            )
        )
        if not published:
            continue
        out.append(
            NewsItem(
                id=_first_text(rec.get("id"), rec.get("code"), rec.get("url"), rec.get("link")) or f"{provider}-{i}",
                title=title,
                summary=_first_text(
                    rec.get("summary"),
                    rec.get("description"),
                    rec.get("content"),
                    rec.get("digest"),
                    rec.get("seendesc"),
                ),
                source=_first_text(rec.get("source"), rec.get("sourceName"), rec.get("domain"), rec.get("infoSource"))
                or provider,
                provider=provider,
                url=_first_text(rec.get("url"), rec.get("link"), rec.get("shareurl")),
                published_at=published,
                hot_score=_to_finite(rec.get("hotScore") or rec.get("hot") or rec.get("weight")),
                relevance_score=_to_finite(rec.get("relevanceScore") or rec.get("relevance_score")),
            )
        )
    return out


def score_news_item(item: NewsItem) -> float:
    text = f"{item.title} {item.summary or ''}"
    score: float = sum(s for s, pat in _NEWS_RULES if pat.search(text))
    score += item.hot_score * 0.1 + item.relevance_score * 10
    if re.search(r"gdelt|alpha-vantage|json-url|eastmoney", item.provider):
        score += 2
    return score


def rank_news(items: list[NewsItem]) -> list[NewsItem]:
    for idx, item in enumerate(items):
        item.importance_score = score_news_item(item) - idx * 0.01
    return sorted(items, key=lambda x: (x.importance_score, x.published_at), reverse=True)


def dedupe_news(items: list[NewsItem]) -> list[NewsItem]:
    seen: set[str] = set()
    out: list[NewsItem] = []
    for item in items:
        key = re.sub(r"\s+", "", (item.url or item.title).lower())[:220]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def is_within_window(iso: str, window: Window) -> bool:
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    return window.start <= t <= window.end


# ---- 简报文案（纯函数，移植 buildSummary/Highlights/WatchList/Risks/NextSteps/DataQuality）----


@dataclass
class NewsBundle:
    items: list[NewsItem] = field(default_factory=list)
    displayed: list[NewsItem] = field(default_factory=list)
    source_stats: list[dict[str, Any]] = field(default_factory=list)


def build_summary(news: NewsBundle, signals: list[dict[str, Any]], window: Window) -> str:
    quality = "候选池仍不足，需要继续补源。" if len(news.items) < MIN_NEWS else "新闻候选池已形成。"
    signal_text = f"社群信号已入库 {len(signals)} 条。" if signals else ""
    return f"过去24小时市场简报已采集至 {_fmt_local(window.end)}，{quality}{signal_text}"


def build_highlights(
    news: NewsBundle, indices: CollectResult, positions: CollectResult, signals: list[dict[str, Any]]
) -> list[str]:
    items: list[str] = []
    if indices.rows:
        items.append(f"指数层已采集 {len(indices.rows)} 个核心市场指标。")
    if positions.rows:
        items.append(f"持仓层已跟踪 {len(positions.rows)} 个标的行情。")
    if signals:
        items.append(f"社群信号层从私有飞书知识源提取 {len(signals)} 条待验证线索，优先展示重要性最高的主题。")
    if news.items:
        items.append(
            f"新闻层从 {len(news.source_stats)} 个来源汇总 {len(news.items)} 条候选，"
            f"默认展示重要性排序前 {min(DISPLAY_NEWS, len(news.items))} 条。"
        )
        items.append(f"当前最高优先级快讯：{news.items[0].title}")
    return items[:6] or ["日报已生成，但数据源候选不足。"]


def build_watch_list(news: NewsBundle, positions: CollectResult, signals: list[dict[str, Any]]) -> list[str]:
    themes = [i.title for i in news.items[:5] if i.title]
    signal_themes = [f"{s.get('theme') or '社群线索'}：{s.get('summary')}" for s in signals[:3] if s.get("summary")]
    return [
        f"核验高优先级社群信号：{'；'.join(signal_themes)}"
        if signal_themes
        else "同步并结构化高质量社群信号，补充一线反馈。",  # noqa: E501
        f"继续核验高优先级新闻：{'；'.join(themes)}" if themes else "补齐中文与国际快讯候选池。",
        "结合持仓标的复核隔夜新闻、公告与盘前价格变化。"
        if positions.rows
        else "补充持仓或自选标的，以便日报给出组合相关跟踪。",  # noqa: E501
    ]


def build_risks(news: NewsBundle, signals: list[dict[str, Any]]) -> list[str]:
    risks: list[str] = []
    if len(news.items) < MIN_NEWS:
        risks.append(f"新闻候选池仅 {len(news.items)} 条，不足以代表过去24小时全量重要事件。")
    if any(not s.get("ok") for s in news.source_stats):
        risks.append("部分新闻源采集失败，重要性排序可能偏向可用来源。")
    if signals:
        risks.append("社群信号来自私域一线反馈，默认是待验证线索，必须用公告、新闻、行情或产业数据交叉核验。")
    return risks or ["新闻排序由规则和来源信号共同驱动，仍需人工复核关键结论。"]


def build_next_steps(news: NewsBundle, signals: list[dict[str, Any]]) -> list[str]:
    return [
        "把高优先级社群信号逐条标记为已验证、待验证或已证伪，并沉淀核验依据。"
        if signals
        else "接入飞书社群信号源，形成日报前的私域线索候选池。",
        "把日报快讯源逐步扩展为东方财富、GDELT、Alpha Vantage/NewsAPI 与后续授权源的组合。",
        "优先修复候选池数量不足问题，再让 LLM 总结 Top 5 影响。"
        if len(news.items) < MIN_NEWS
        else "在候选 Top 50 基础上加入 LLM 影响归因。",
    ]


def build_data_quality(
    news: NewsBundle, indices: CollectResult, positions: CollectResult, signals: list[dict[str, Any]], window: Window
) -> list[dict[str, str]]:
    src = " · ".join(f"{s['provider']}:{s['count'] if s['ok'] else '失败'}" for s in news.source_stats)
    return [
        {"name": "采集窗口", "status": f"{_format_window(window)} · 固定24小时"},
        {"name": "指数行情", "status": f"正常 · {len(indices.rows)} 条" if indices.ok else f"失败 · {indices.error}"},
        {
            "name": "持仓行情",
            "status": f"正常 · {len(positions.rows)} 条" if positions.ok else f"降级 · {positions.error}",
        },  # noqa: E501
        {"name": "社群信号", "status": f"正常 · {len(signals)} 条" if signals else "暂无"},
        {
            "name": "新闻候选池",
            "status": f"不足 · {len(news.items)} 条" if len(news.items) < MIN_NEWS else f"正常 · {len(news.items)} 条",
        },  # noqa: E501
        {"name": "新闻源", "status": src or "未配置"},
    ]


def _format_rows(rows: list[dict[str, Any]]) -> str:
    return "\n".join(" | ".join(f"{k}: {v}" for k, v in row.items()) for row in rows)


def assemble_brief(
    now: datetime, indices: CollectResult, positions: CollectResult, news: NewsBundle, signals: list[dict[str, Any]]
) -> dict[str, Any]:
    """把已采集结果组装为报告 brief（纯函数：不含抓取）。"""
    window = build_news_window(now)
    news_excerpt = (
        "\n".join(
            f"[{_fmt_local(datetime.fromisoformat(i.published_at.replace('Z', '+00:00')))}] {i.title}"
            for i in news.displayed
        )
        or "未采集到新闻候选。"
    )
    evidence = [
        {
            "title": "大盘指数",
            "source": indices.source or "系统采集",
            "observedAt": now.isoformat(),
            "confidence": "medium" if indices.ok else "low",
            "excerpt": _format_rows(indices.rows),
        },
        {
            "title": "持仓行情",
            "source": positions.source or "持仓",
            "observedAt": now.isoformat(),
            "confidence": "medium" if positions.ok else "low",
            "excerpt": _format_rows(positions.rows),
        },
        {
            "title": f"今日财经快讯 ({len(news.displayed)}条)",
            "source": f"多源快讯 · 候选池 {len(news.items)} 条",
            "observedAt": window.end.isoformat(),
            "confidence": "medium" if len(news.items) >= MIN_NEWS else "low",
            "excerpt": news_excerpt,
        },
    ]
    return {
        "summary": build_summary(news, signals, window),
        "highlights": build_highlights(news, indices, positions, signals),
        "watchList": build_watch_list(news, positions, signals),
        "risks": build_risks(news, signals),
        "nextSteps": build_next_steps(news, signals),
        "tags": ["每日简报", "市场", "新闻", "知识库", *(["社群信号"] if signals else [])],
        "evidence": [e for e in evidence if e["excerpt"]],
        "dataQuality": build_data_quality(news, indices, positions, signals, window),
        "window": window,
    }


# ---- 采集层（I/O：指数/持仓/东财快讯），普通测试打桩不走网络 ----

_INDEX_SECIDS = {
    "000001.SH": "1.000001",
    "399001.SZ": "0.399001",
    "399006.SZ": "0.399006",
    "000688.SH": "1.000688",
    "HSI.HK": "100.HSI",
    "IXIC.US": "100.NDX",
    "SPX.US": "100.SPX",
}


async def collect_market_indices() -> CollectResult:
    """东财 ulist 指数行情 → CollectResult（复用 providers.eastmoney.fetch_index_list）。"""
    from app.providers.eastmoney import fetch_index_list

    try:
        rows = await fetch_index_list(_INDEX_SECIDS)
        return CollectResult(
            ok=True,
            source="东方财富行情",
            rows=[{"指数简称": r["name"], "涨跌幅": r["changePct"], "现价": r["level"]} for r in rows],
        )
    except Exception as e:  # noqa: BLE001 —— 采集容错
        return CollectResult(ok=False, source="东方财富行情", error=str(e)[:180])


async def collect_position_quotes(positions: list[dict[str, Any]]) -> CollectResult:
    """持仓行情（限 20 条），逐条走 get_stock_quote，失败降级只列成本。"""
    from app.providers.eastmoney import get_stock_quote

    if not positions:
        return CollectResult(ok=True, source="持仓", note="暂无持仓")
    rows: list[dict[str, Any]] = []
    for pos in positions[:20]:
        key = pos.get("quoteSecid") or pos.get("quote_secid") or pos.get("code")
        try:
            quote = await get_stock_quote(str(key)) if key else None
        except Exception:  # noqa: BLE001
            quote = None
        rows.append(
            {
                "证券代码": pos.get("code"),
                "证券简称": pos.get("name") or (quote and quote.get("name")) or "",
                "市场": pos.get("market") or (quote and quote.get("market")) or "",
                "现价": (quote and quote.get("price")) or "",
                "涨跌幅": (quote and quote.get("changePct")) or "",
                "持仓数量": pos.get("shares") or 0,
                "成本": pos.get("cost") or 0,
            }
        )
    return CollectResult(ok=True, source="持仓行情", rows=rows)


async def collect_news(window: Window, *, eastmoney_enabled: bool = True) -> NewsBundle:
    """东财快讯采集（可选），规整/去重/窗口过滤/排序。无源则空池。"""
    import httpx

    stats: list[dict[str, Any]] = []
    raw: list[NewsItem] = []
    if eastmoney_enabled:
        try:
            async with httpx.AsyncClient(timeout=8.0, headers={"user-agent": "Mozilla/5.0"}) as client:
                url = (
                    "https://np-listapi.eastmoney.com/comm/web/getFastNewsList"
                    "?client=web&biz=web_724&fastColumn=102&pageSize=100&sortEnd="
                )
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                page = (data.get("data") or {}).get("fastNewsList") or (data.get("data") or {}).get("items") or []
            items = normalize_news_items(page, "eastmoney")
            raw.extend(items)
            stats.append({"provider": "eastmoney", "ok": True, "count": len(items), "error": ""})
        except Exception as e:  # noqa: BLE001
            stats.append({"provider": "eastmoney", "ok": False, "count": 0, "error": str(e)[:180]})
    if not stats:
        stats.append({"provider": "news-provider", "ok": False, "count": 0, "error": "未配置新闻源"})
    items = rank_news([i for i in dedupe_news(raw) if is_within_window(i.published_at, window)])[:MAX_NEWS]
    return NewsBundle(items=items, displayed=items[:DISPLAY_NEWS], source_stats=stats)


async def run_daily_briefing(
    now: datetime, positions: list[dict[str, Any]], signals: list[dict[str, Any]], *, eastmoney_enabled: bool = True
) -> dict[str, Any]:
    """日报采集编排：并发抓指数/持仓/快讯 → assemble_brief。"""
    import asyncio

    window = build_news_window(now)
    indices, position_quotes, news = await asyncio.gather(
        collect_market_indices(),
        collect_position_quotes(positions),
        collect_news(window, eastmoney_enabled=eastmoney_enabled),
    )
    return assemble_brief(now, indices, position_quotes, news, signals)
