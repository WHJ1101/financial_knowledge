"""M11.2 每日简报纯函数测试（方案 §13/§14）。

覆盖：窗口、日期规整、新闻规整/评分/排序/去重/窗口过滤、简报组装（assemble_brief）。
不打真实网络（采集层 collect_* 是 I/O，另在集成层验证）。
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.daily_briefing import (
    CollectResult,
    NewsBundle,
    NewsItem,
    assemble_brief,
    build_news_window,
    dedupe_news,
    expand_records,
    is_within_window,
    normalize_news_date,
    normalize_news_items,
    rank_news,
    score_news_item,
)

_NOW = datetime(2026, 7, 15, 8, 0, 0, tzinfo=UTC)


def test_build_news_window():
    w = build_news_window(_NOW)
    assert w.end == _NOW
    assert (w.end - w.start).days == 1


def test_normalize_news_date_formats():
    # 14 位数字（北京时间）
    iso = normalize_news_date("20260715120000")
    assert iso.startswith("2026-07-15T04:00")  # 12:00 CST → 04:00 UTC
    # YYYY-MM-DD HH:MM（+08:00）
    iso2 = normalize_news_date("2026-07-15 12:00")
    assert iso2.startswith("2026-07-15T04:00")
    assert normalize_news_date("") == ""
    assert normalize_news_date("垃圾") == ""


def test_expand_records():
    assert expand_records({"fastNewsList": [1, 2]}) == [1, 2]
    assert expand_records({"data": [{"x": 1}]}) == [{"x": 1}]  # data 为 list 才解包
    assert expand_records({"x": 1}) == [{"x": 1}]  # 无已知 list 键 → 包成单元素
    assert expand_records(None) == []


def test_normalize_news_items_filters_no_title_or_date():
    records = [
        {"title": "央行降准", "showTime": "20260715090000"},
        {"title": "无时间的新闻"},  # 无发布时间 → 剔除
        {"summary": "无标题"},  # 无标题 → 剔除
    ]
    items = normalize_news_items(records, "eastmoney")
    assert len(items) == 1
    assert items[0].title == "央行降准"
    assert items[0].provider == "eastmoney"


def test_score_and_rank_news():
    a = NewsItem(id="1", title="央行降准降息", provider="eastmoney", published_at="2026-07-15T09:00:00+00:00")
    b = NewsItem(
        id="2", title="某公司取得1项发明专利证书", provider="eastmoney", published_at="2026-07-15T08:00:00+00:00"
    )
    assert score_news_item(a) > score_news_item(b)  # 货币政策 > 负规则
    ranked = rank_news([b, a])
    assert ranked[0].id == "1"  # 高分在前


def test_dedupe_news():
    a = NewsItem(id="1", title="同标题", provider="p", published_at="t", url="http://x")
    b = NewsItem(id="2", title="同标题", provider="p", published_at="t", url="http://x")  # 同 url
    assert len(dedupe_news([a, b])) == 1


def test_is_within_window():
    w = build_news_window(_NOW)
    assert is_within_window("2026-07-15T06:00:00+00:00", w) is True
    assert is_within_window("2026-07-01T00:00:00+00:00", w) is False
    assert is_within_window("bad", w) is False


def test_assemble_brief_shape():
    indices = CollectResult(ok=True, source="东财", rows=[{"指数简称": "上证", "涨跌幅": "1.5"}])
    positions = CollectResult(ok=True, source="持仓", rows=[{"证券代码": "600000", "现价": 10}])
    news = NewsBundle(
        items=[NewsItem(id="1", title="央行降准", provider="eastmoney", published_at="2026-07-15T06:00:00+00:00")],
        displayed=[NewsItem(id="1", title="央行降准", provider="eastmoney", published_at="2026-07-15T06:00:00+00:00")],
        source_stats=[{"provider": "eastmoney", "ok": True, "count": 1, "error": ""}],
    )
    brief = assemble_brief(_NOW, indices, positions, news, signals=[])
    assert brief["summary"]
    assert "市场" in brief["tags"]
    assert any(e["title"] == "大盘指数" for e in brief["evidence"])
    assert any(q["name"] == "新闻源" for q in brief["dataQuality"])
    # 候选池不足（1 < 30）应体现在数据质量
    news_q = next(q for q in brief["dataQuality"] if q["name"] == "新闻候选池")
    assert "不足" in news_q["status"]
