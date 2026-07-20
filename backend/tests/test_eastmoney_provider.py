"""东财 Provider 解析纯函数测试（fixture 契约测试，方案 §6.3）。

用保存的真实响应形状 fixture，不打真实接口。字段量纲对齐辩论文档附录 A。
"""

from __future__ import annotations

from app.providers.base import InstrumentRef
from app.providers.eastmoney import (
    _first_ok,
    eastmoney_secid,
    parse_fundamentals,
    parse_kline,
    parse_quote,
)


async def test_first_ok_builds_fallback_lazily() -> None:
    calls: list[str] = []

    async def primary() -> str | None:
        calls.append("primary")
        return "ok"

    async def fallback() -> str | None:
        calls.append("fallback")
        return "fallback"

    assert await _first_ok(primary, fallback) == "ok"
    assert calls == ["primary"]

# 东财 kline 真实响应形状（fields2=f51,f53,f56）
_KLINE_FIXTURE = {
    "data": {
        "code": "301308",
        "klines": ["2026-06-20,45.30,1200000", "2026-06-23,46.10,1500000", "2026-06-24,44.80,980000"],
    }
}

# 东财 push2 stock/get 基本面（辩论文档附录 A：江波龙 PE 143.0 需 f162=14300）
_FUND_FIXTURE = {
    "data": {
        "f57": "301308",
        "f58": "江波龙",
        "f162": 14300,
        "f167": 1855,
        "f116": 50000000000,
        "f173": 39.4,
        "f184": 132.8,
        "f185": 2644,
    }
}
_QUOTE_FIXTURE = {"data": {"f43": 4530, "f58": "江波龙", "f170": 250}}


def test_parse_kline():
    bars = parse_kline(_KLINE_FIXTURE)
    assert len(bars) == 3
    assert bars[0].date == "2026-06-20"
    assert bars[0].close == 45.30
    assert bars[0].volume == 1200000
    assert bars[2].close == 44.80


def test_parse_kline_null_data():
    assert parse_kline({"data": None}) == []
    assert parse_kline({}) == []


def test_parse_fundamentals_scale():
    snap = parse_fundamentals(_FUND_FIXTURE)
    assert snap.pe == 143.0  # f162=14300 / 100
    assert snap.pb == 18.55  # f167=1855 / 100
    assert snap.roe == 39.4
    assert snap.profit_yoy == 2644
    assert snap.revenue_yoy == 132.8
    assert snap.data_gap is None


def test_parse_fundamentals_no_data():
    snap = parse_fundamentals({"data": None})
    assert snap.data_gap == "估值接口无数据"
    assert snap.pe is None


def test_parse_quote_scale():
    q = parse_quote(_QUOTE_FIXTURE)
    assert q.price == 45.30  # f43=4530 / 100
    assert q.change_pct == "2.50"  # f170=250 / 100
    assert q.name == "江波龙"


def test_eastmoney_secid_from_provider_ids():
    ref = InstrumentRef("301308", "SZSE", "equity", {"eastmoney": "0.301308"})
    assert eastmoney_secid(ref) == "0.301308"


def test_eastmoney_secid_inferred():
    assert eastmoney_secid(InstrumentRef("603986", "SSE", "equity")) == "1.603986"
    assert eastmoney_secid(InstrumentRef("301308", "SZSE", "equity")) == "0.301308"
    assert eastmoney_secid(InstrumentRef("014662", "OTC_FUND", "open_end_fund")) == "OF.014662"
