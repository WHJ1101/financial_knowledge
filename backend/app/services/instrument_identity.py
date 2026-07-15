"""证券身份规范化（方案 §4.1，ADR-027）。

把存量混杂的 code + market 归一到 (exchange, asset_class, canonical_symbol)。
实测存量样例：SZ301308/创业板、603986/沪市主板、688110/科创板、159995/ETF、
014662/基金、00100/美股。market 是人工标签，作为主信号；code 前缀/号段辅助判定。

规范化失败（无法判定 exchange/asset_class）时返回 None，由迁移脚本进 reconciliation 人工确认，
不硬塞（方案 §5.3 校验清单）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class NormalizedInstrument:
    exchange: str  # SSE/SZSE/HKEX/NASDAQ/NYSE/US/OTC_FUND
    asset_class: str  # equity/etf/open_end_fund/hk_stock/us_stock
    canonical_symbol: str  # 剥前缀纯代码
    display_code: str  # 原样保留


# market 展示标签 → (exchange 推断依据, asset_class)
_MARKET_EQUITY = {
    "创业板": "SZSE",
    "深市主板": "SZSE",
    "中小板": "SZSE",
    "沪市主板": "SSE",
    "科创板": "SSE",
}


def _strip_prefix(code: str) -> str:
    """剥离常见前缀，取纯代码主体。

    SZ301308→301308, SH603986→603986, OF.014662→014662, 0.159915→159915,
    1.588080→588080, 150.007722→007722。
    """
    c = code.strip().upper()
    c = re.sub(r"^(SZ|SH|BJ|HK)", "", c)  # 字母交易所前缀
    c = re.sub(r"^(OF|OTC)\.", "", c)  # 场外基金前缀
    c = re.sub(r"^\d+\.", "", c)  # 东财数字前缀 0./1./105./150.
    return c


def _exchange_for_ashare_code(symbol: str) -> str | None:
    """按 A 股/ETF 号段推断交易所。"""
    if re.fullmatch(r"\d{6}", symbol):
        # 沪市：60xxxx(主板) 68xxxx(科创) 5xxxxx(ETF/基金)
        if symbol[0] == "6" or symbol.startswith("5"):
            return "SSE"
        # 深市：00xxxx 30xxxx(创业板) 15xxxx(ETF) 16xxxx/18xxxx(LOF/基金)
        if symbol[0] in ("0", "1", "3"):
            return "SZSE"
    return None


def normalize(code: str, market: str | None) -> NormalizedInstrument | None:
    """归一证券身份。无法判定返回 None（进 reconciliation）。"""
    if not code:
        return None
    display_code = code.strip()
    market = (market or "").strip()
    symbol = _strip_prefix(display_code)

    # 港股
    if market == "港股" or display_code.upper().startswith("HK"):
        return NormalizedInstrument("HKEX", "hk_stock", symbol, display_code)

    # 美股（存量仅展示标签，交易所未知，用 US 占位；唯一键仍成立）
    if market == "美股":
        return NormalizedInstrument("US", "us_stock", symbol, display_code)

    # 场外开放式基金
    if market == "基金" or display_code.upper().startswith("OF."):
        return NormalizedInstrument("OTC_FUND", "open_end_fund", symbol, display_code)

    # 场内 ETF
    if market == "ETF":
        exchange = _exchange_for_ashare_code(symbol) or "SSE"
        return NormalizedInstrument(exchange, "etf", symbol, display_code)

    # A 股股票（按 market 标签）
    if market in _MARKET_EQUITY:
        return NormalizedInstrument(_MARKET_EQUITY[market], "equity", symbol, display_code)

    # 兜底：按号段推断交易所，作为 equity
    inferred = _exchange_for_ashare_code(symbol)
    if inferred:
        return NormalizedInstrument(inferred, "equity", symbol, display_code)

    return None  # 无法判定 → reconciliation


def merge_provider_id(provider_ids: dict[str, str], secid: str, kind: str) -> dict[str, str]:
    """把 secid_map 的一条并入 provider_ids（方案 §4.1）。

    kind=exchange → eastmoney（如 0.159915）；kind=fund → fund（如 OF.014662）。
    """
    result = dict(provider_ids)
    if kind == "fund":
        result["fund"] = secid
    else:
        result["eastmoney"] = secid
    return result
