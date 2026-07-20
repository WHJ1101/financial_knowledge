"""东财行情/K线/基本面 Provider（移植 market-data.js + kline-store.js，方案 §6.2）。

解析逻辑抽成纯函数（parse_*），可用保存的真实响应 fixture 契约测试（§6.3），
不打真实接口。HTTP 抓取用 httpx.AsyncClient + 重试。
PE/PB 需 /100（辩论文档附录 A）。

M11.1 扩展：搜索建议 / 交易所行情(gtimg GBK) / 场外基金(天天+东财) / 指数快照(push2 ulist)，
统一沿用旧 market-data.js 的响应 shape（MarketQuote：name/price/market/high/low/open/changePct/...）。
"""

from __future__ import annotations

import json
import math
import re
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict
from urllib.parse import quote_plus

import httpx

from app.providers.base import Bar, FundamentalSnapshot, InstrumentRef, QuoteSnapshot

_UA = "Mozilla/5.0"
_TIMEOUT = 8.0
_MAX_ATTEMPTS = 3


# ---- 市场数据响应类型（沿用旧 market-data.js shape，camelCase 与前端契约一致）----


class MarketQuote(TypedDict, total=False):
    """统一行情快照。source ∈ exchange|fund-estimate|fund-nav|manual。"""

    name: str
    price: float
    market: str
    high: float
    low: float
    open: float
    changePct: str
    source: str
    sourceLabel: str
    nav: float | None
    navDate: str
    updatedAt: str
    note: str


class SearchResult(TypedDict):
    code: str
    name: str
    market: str
    secid: str


class IndexLive(TypedDict):
    code: str
    name: str
    level: str | None
    changePct: str | None
    volume: Any


# 东财基本面字段（辩论文档附录 A）
_F_PE, _F_PB, _F_MKTCAP, _F_ROE, _F_REV_YOY, _F_PROFIT_YOY = "f162", "f167", "f116", "f173", "f184", "f185"


def eastmoney_secid(ref: InstrumentRef) -> str:
    """由证券身份构造东财 secid。优先用 provider_ids.eastmoney，否则按交易所推断。"""
    if ref.provider_ids.get("eastmoney"):
        return ref.provider_ids["eastmoney"]
    prefix = {"SSE": "1", "SZSE": "0"}.get(ref.exchange)
    if prefix:
        return f"{prefix}.{ref.canonical_symbol}"
    # 场外基金用 OF. 前缀（东财基金接口）
    if ref.asset_class == "open_end_fund":
        return f"OF.{ref.canonical_symbol}"
    return ref.canonical_symbol


# ---- 纯解析函数（fixture 契约测试，§6.3）----


def parse_kline(payload: dict[str, Any]) -> list[Bar]:
    """东财 kline：fields2=f51,f53,f56 即 date,close,volume。data=null → []。"""
    klines = (payload.get("data") or {}).get("klines")
    if not isinstance(klines, list):
        return []
    bars: list[Bar] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 3:
            continue
        date, close, volume = parts[0], parts[1], parts[2]
        try:
            close_num = float(close)
        except (ValueError, TypeError):
            continue
        try:
            volume_num: float | None = float(volume)
        except (ValueError, TypeError):
            volume_num = None
        if not date:
            continue
        bars.append(Bar(date=date, close=close_num, volume=volume_num))
    return bars


def _f(data: dict[str, Any], key: str, scale: float = 1.0) -> float | None:
    v = data.get(key)
    if v is None or v == "-":
        return None
    try:
        return float(v) / scale
    except (ValueError, TypeError):
        return None


def parse_fundamentals(payload: dict[str, Any], source_url: str = "") -> FundamentalSnapshot:
    """东财 push2 stock/get 估值快照。PE/PB /100（辩论文档附录 A 量纲）。"""
    data = payload.get("data")
    now = datetime.now(UTC)
    if not data:
        return FundamentalSnapshot(source_url=source_url, retrieved_at=now, data_gap="估值接口无数据")
    return FundamentalSnapshot(
        pe=_f(data, _F_PE, 100),
        pb=_f(data, _F_PB, 100),
        roe=_f(data, _F_ROE),
        revenue_yoy=_f(data, _F_REV_YOY),
        profit_yoy=_f(data, _F_PROFIT_YOY),
        market_cap=_f(data, _F_MKTCAP),
        source="eastmoney",
        source_url=source_url,
        retrieved_at=now,
    )


def parse_quote(payload: dict[str, Any], source_url: str = "") -> QuoteSnapshot:
    """东财 push2 stock/get 行情快照（f43 现价 /100, f170 涨跌幅 /100, f58 名称）。"""
    data = payload.get("data")
    now = datetime.now(UTC)
    if not data:
        return QuoteSnapshot(
            name="",
            price=None,
            change_pct=None,
            source="eastmoney",
            source_url=source_url,
            retrieved_at=now,
            data_gap="行情接口无数据",
        )
    price = _f(data, "f43", 100)
    change = _f(data, "f170", 100)
    return QuoteSnapshot(
        name=str(data.get("f58") or ""),
        price=price,
        change_pct=f"{change:.2f}" if change is not None else None,
        source="eastmoney",
        source_url=source_url,
        retrieved_at=now,
        raw={"f43": data.get("f43"), "f170": data.get("f170")},
    )


# ---- M11.1 市场数据纯解析函数（移植 market-data.js，fixture 契约测试）----


def _to_number(value: Any) -> float | None:
    """JS toNumber：非有限数 → None（对齐 Number.isFinite 语义）。"""
    try:
        n = float(value)
    except (ValueError, TypeError):
        return None
    return n if math.isfinite(n) else None


def is_exchange_fund_code(code: Any) -> bool:
    """场内基金/ETF 代码（15/16/50/51/52/56/58 开头 6 位）。"""
    return bool(re.match(r"^(15|16|50|51|52|56|58)\d{4}$", str(code or "")))


def extract_security_code(value: Any) -> str:
    """从任意串里抠出首个 6 位证券代码，无则空串。"""
    m = re.search(r"\b\d{6}\b", str(value or ""))
    return m.group(0) if m else ""


def is_otc_fund_secid(secid: str) -> bool:
    """场外基金 secid：市场号为 150。"""
    return secid.split(".")[0] == "150"


def classify_security(item: dict[str, Any]) -> str:
    """搜索建议条目 → 市场标签（移植 classifySecurity）。"""
    classify = str(item.get("Classify") or "")
    security_type = str(item.get("SecurityType") or "")
    security_type_name = str(item.get("SecurityTypeName") or "")
    jys = str(item.get("JYS") or "")
    mkt_num = str(item.get("MktNum") or "")
    quote_market = str(item.get("QuoteID") or "").partition(".")[0]
    if classify == "AStock":
        return "A股"
    if classify == "HKStock" or jys.upper() in ("HK", "HKEX") or mkt_num == "116" or quote_market == "116":
        return "港股"
    if classify in ("USStock", "UsStock") or mkt_num in ("105", "106") or quote_market in ("105", "106"):
        return "美股"
    if jys == "OTCFUND" or classify == "OTCFUND" or mkt_num == "150" or security_type == "17":
        return "基金"
    if classify == "Fund" or "基金" in security_type_name:
        return "ETF" if is_exchange_fund_code(item.get("Code")) else "基金"
    # 无法识别时不再默认美股，避免港股涡轮/牛熊证等被静默错分。
    return "未知"


def classify_market_from_secid(mkt: str, code: str) -> str:
    """交易所行情市场标签（移植 classifyMarketFromSecid）。"""
    if is_exchange_fund_code(code):
        return "ETF"
    if mkt == "116":
        return "港股"
    if mkt in ("105", "106"):
        return "美股"
    return "A股"


def parse_search(payload: dict[str, Any]) -> list[SearchResult]:
    """东财 suggest 建议列表（QuotationCodeTable.Data → code/name/market/secid）。"""
    table = payload.get("QuotationCodeTable") or {}
    items = table.get("Data") or []
    if not isinstance(items, list):
        return []
    return [
        SearchResult(
            code=str(d.get("Code") or ""),
            name=str(d.get("Name") or ""),
            market=classify_security(d),
            secid=str(d.get("QuoteID") or ""),
        )
        for d in items
    ]


def parse_index_list(payload: dict[str, Any]) -> list[IndexLive]:
    """push2 ulist.np（fields=f1..f14）→ 指数快照。level/changePct 需 /100 且格式化两位小数。"""
    diff = (payload.get("data") or {}).get("diff")
    if not isinstance(diff, list):
        return []
    out: list[IndexLive] = []
    for item in diff:
        f2, f3, f6 = item.get("f2"), item.get("f3"), item.get("f6")
        out.append(
            IndexLive(
                code=str(item.get("f12") or ""),
                name=str(item.get("f14") or ""),
                level=None if f2 in ("-", None) else f"{float(f2) / 100:.2f}",
                changePct=None if f3 in ("-", None) else f"{float(f3) / 100:.2f}",
                volume=None if f6 in ("-", None) else f6,
            )
        )
    return out


def _fnum_or(parts: list[str], idx: int, default: float) -> float:
    """gtimg 字段解析：空/非数/0 → default（对齐 JS `parseFloat(x) || default`）。"""
    try:
        return float(parts[idx]) or default
    except (ValueError, IndexError):
        return default


def parse_exchange_quote(text: str, secid: str) -> MarketQuote | None:
    """gtimg（qt.gtimg.cn，GBK 解码后）`~` 分隔行情。移植 getExchangeQuote 字段口径。"""
    mkt, _, code = secid.partition(".")
    if not code:
        return None
    parts = text.split("~")
    if len(parts) < 35:
        return None
    try:
        price = float(parts[3])
    except (ValueError, IndexError):
        return None
    if not price:
        return None
    try:
        prev_close = float(parts[4])
    except (ValueError, IndexError):
        prev_close = 0.0
    change_pct = f"{(price - prev_close) / prev_close * 100:.2f}" if prev_close else "0.00"
    return MarketQuote(
        name=parts[1],
        price=price,
        market=classify_market_from_secid(mkt, code),
        high=_fnum_or(parts, 33, price),
        low=_fnum_or(parts, 34, price),
        open=_fnum_or(parts, 5, price),
        changePct=change_pct,
        source="exchange",
        sourceLabel="交易所行情",
    )


def parse_tiantian_fund(text: str) -> MarketQuote | None:
    """天天基金 jsonpgz(...) 估值。有估算净值(gsz)优先，否则用最新净值(dwjz)。"""
    m = re.match(r"^jsonpgz\((.*)\);?$", (text or "").strip(), re.S)
    payload = m.group(1).strip() if m else None
    if not payload or payload in ("null", "undefined"):
        return None
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        return None
    estimated = _to_number(data.get("gsz"))
    latest = _to_number(data.get("dwjz"))
    price = estimated or latest
    if not price:
        return None
    change = _to_number(data.get("gszzl"))
    return MarketQuote(
        name=str(data.get("name") or ""),
        price=price,
        market="基金",
        high=price,
        low=price,
        open=latest or price,
        changePct=f"{change:.2f}" if change is not None else "0.00",
        source="fund-estimate" if estimated else "fund-nav",
        sourceLabel="基金估算净值" if estimated else "基金最新净值",
        nav=latest or None,
        navDate=str(data.get("jzrq") or ""),
        updatedAt=str(data.get("gztime") or data.get("jzrq") or ""),
    )


def _read_js_string_var(text: str, name: str) -> str:
    m = re.search(rf'var\s+{name}\s*=\s*["\']([^"\']*)["\']\s*;', text or "")
    return m.group(1) if m else ""


def _read_js_array_var(text: str, name: str) -> list[Any] | None:
    m = re.search(rf"var\s+{name}\s*=\s*(\[[\s\S]*?\])\s*;", text or "")
    if not m:
        return None
    try:
        parsed = json.loads(m.group(1).strip())
        return parsed if isinstance(parsed, list) else None
    except (ValueError, TypeError):
        return None


def _format_timestamp_date(value: Any) -> str:
    """毫秒时间戳 → UTC YYYY-MM-DD（对齐 JS new Date(ms).toISOString().slice(0,10)）。"""
    try:
        ms = float(value)
    except (ValueError, TypeError):
        return ""
    if not math.isfinite(ms):
        return ""
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%Y-%m-%d")


def parse_eastmoney_fund_page(text: str, code: str = "") -> MarketQuote | None:
    """东财 pingzhongdata 基金页：取 Data_netWorthTrend 末点单位净值。"""
    name = _read_js_string_var(text, "fS_name") or code
    trend = _read_js_array_var(text, "Data_netWorthTrend")
    latest = trend[-1] if isinstance(trend, list) and trend else None
    price = _to_number(latest.get("y")) if isinstance(latest, dict) else None
    if not price:
        return None
    change = _to_number(latest.get("equityReturn")) if isinstance(latest, dict) else None
    nav_date = _format_timestamp_date(latest.get("x")) if isinstance(latest, dict) else ""
    return MarketQuote(
        name=name,
        price=price,
        market="基金",
        high=price,
        low=price,
        open=price,
        changePct=f"{change:.2f}" if change is not None else "0.00",
        source="fund-nav",
        sourceLabel="东方财富基金净值",
        nav=price,
        navDate=nav_date,
        updatedAt=nav_date,
    )


# ---- HTTP 抓取（带重试；真实网络，普通测试不调用）----


async def _get_json(url: str) -> dict[str, Any]:
    last_err: Exception | None = None
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"user-agent": _UA}) as client:
        for _attempt in range(_MAX_ATTEMPTS):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data: dict[str, Any] = resp.json()
                return data
            except (httpx.HTTPError, ValueError) as err:
                last_err = err
    raise RuntimeError(f"抓取失败: {url}") from last_err


async def _get_text(url: str, *, gbk: bool = False, headers: dict[str, str] | None = None) -> str | None:
    """抓文本（gtimg GBK / 基金 JSONP）。失败返回 None（对齐旧 `.catch(() => null)`）。"""
    hdrs = {"user-agent": _UA, **(headers or {})}
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=hdrs) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content.decode("gbk", errors="replace") if gbk else resp.text
        except (httpx.HTTPError, ValueError, UnicodeDecodeError):
            return None


async def _first_ok[T](*factories: Callable[[], Awaitable[T | None]]) -> T | None:
    """依次 await，返回首个非 None（对齐旧串行 fallback 语义）。"""
    for factory in factories:
        result = await factory()
        if result is not None:
            return result
    return None


# ---- M11.1 市场数据抓取（真实网络，编排纯解析函数）----

_SUGGEST_URL = "https://searchapi.eastmoney.com/api/suggest/get?input={q}&type=14&count=8"
_INDEX_SECIDS = {
    "000001.SH": "1.000001",
    "399001.SZ": "0.399001",
    "399006.SZ": "0.399006",
    "000688.SH": "1.000688",
    "HSI.HK": "100.HSI",
    "IXIC.US": "100.NDX",
    "SPX.US": "100.SPX",
}
_INDEX_FIELDS = "f1,f2,f3,f4,f6,f12,f14"
_FUND_HEADERS = {"referer": "https://fund.eastmoney.com/"}


async def search_stocks(keyword: str) -> list[SearchResult]:
    """东财 suggest 搜索建议。抓取失败 → []。"""
    payload = await _get_json(_SUGGEST_URL.format(q=quote_plus(keyword)))
    return parse_search(payload)


async def get_exchange_quote(secid: str) -> MarketQuote | None:
    """gtimg 交易所行情（sh/sz/hk/us 前缀由市场号推断）。"""
    mkt, _, code = secid.partition(".")
    if not code:
        return None
    prefix = {"1": "sh", "0": "sz", "116": "hk", "105": "us", "106": "us"}.get(mkt)
    if prefix is None:
        return None
    text = await _get_text(f"https://qt.gtimg.cn/q={prefix}{code}", gbk=True)
    return parse_exchange_quote(text, secid) if text else None


async def get_fund_quote(code: str) -> MarketQuote | None:
    """场外基金：天天估值优先，降级东财净值页。"""
    if not re.match(r"^\d{6}$", code):
        return None
    ts = int(time.time() * 1000)

    async def _tiantian() -> MarketQuote | None:
        text = await _get_text(f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}")
        return parse_tiantian_fund(text) if text else None

    async def _eastmoney() -> MarketQuote | None:
        text = await _get_text(f"https://fund.eastmoney.com/pingzhongdata/{code}.js?v={ts}", headers=_FUND_HEADERS)
        return parse_eastmoney_fund_page(text, code) if text else None

    return await _first_ok(_tiantian, _eastmoney)


async def get_stock_quote(secid: str) -> MarketQuote | None:
    """统一行情入口（移植 getStockQuote，不含 manual 兜底——由 API 层查 quote_overrides）。"""
    normalized = str(secid or "").strip()
    code = extract_security_code(normalized)
    if is_otc_fund_secid(normalized):
        return await get_fund_quote(code) if code else None
    exchange = await get_exchange_quote(normalized)
    if exchange is not None:
        return exchange
    return await get_fund_quote(code) if code else None


async def fetch_index_list(secids: dict[str, str] | None = None) -> list[IndexLive]:
    """push2 ulist 批量指数快照（默认全部内置指数）。"""
    mapping = secids or _INDEX_SECIDS
    joined = ",".join(mapping.values())
    url = f"https://push2.eastmoney.com/api/qt/ulist.np/get?fields={_INDEX_FIELDS}&secids={joined}"
    return parse_index_list(await _get_json(url))


# ---- 历史日线回补（组合曲线 / 压力监控，移植 kline-store.js）----


def _shift_date(ymd: str, delta_days: int) -> str:
    d = datetime.fromisoformat(f"{ymd}T00:00:00+00:00") + timedelta(days=delta_days)
    return d.strftime("%Y%m%d")


async def fetch_historical_exchange_bars(
    secid: str, chunk_size: int = 2000, max_chunks: int = 100
) -> list[dict[str, Any]]:
    """东财交易所历史日线（前复权 fqt=1），分页向更早翻，去重升序。移植 fetchHistoricalExchangeBars。"""
    by_date: dict[str, dict[str, Any]] = {}
    end = "20500101"
    earliest_seen: str | None = None
    for _chunk in range(max_chunks):
        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}"
            f"&klt=101&fqt=1&fields1=f1,f2&fields2=f51,f53,f56&beg=0&end={end}&lmt={chunk_size}"
        )
        try:
            payload = await _get_json(url)
        except RuntimeError:
            break
        klines = (payload.get("data") or {}).get("klines")
        if not isinstance(klines, list) or not klines:
            break
        for line in klines:
            parts = str(line).split(",")
            if len(parts) < 2:
                continue
            date, close = parts[0], parts[1]
            try:
                close_num = float(close)
            except (ValueError, TypeError):
                continue
            if not date or close_num <= 0:
                continue
            volume: float | None = None
            if len(parts) >= 3:
                try:
                    volume = float(parts[2])
                except (ValueError, TypeError):
                    volume = None
            by_date[date] = {"date": date, "close": close_num, "volume": volume}
        if len(klines) < chunk_size:
            break
        page_earliest = str(klines[0]).split(",")[0]
        if earliest_seen and page_earliest >= earliest_seen:
            break
        earliest_seen = page_earliest
        end = _shift_date(page_earliest, -1)
    return sorted(by_date.values(), key=lambda b: b["date"])


async def fetch_fund_nav_history(code: str) -> list[dict[str, Any]]:
    """场外基金历史净值序列 [{date, close}]（前复权口径，移植 fetchFundNavHistory/parseFundNavHistory）。"""
    if not re.match(r"^\d{6}$", str(code or "")):
        return []
    ts = int(time.time() * 1000)
    text = await _get_text(f"https://fund.eastmoney.com/pingzhongdata/{code}.js?v={ts}", headers=_FUND_HEADERS)
    return parse_fund_nav_history(text) if text else []


def parse_fund_nav_history(text: str) -> list[dict[str, Any]]:
    """pingzhongdata 累计净值(ACWorth)缩放到最新单位净值锚，缺失降级单位净值。移植 parseFundNavHistory。"""
    ac_raw = _read_js_array_var(text, "Data_ACWorthTrend")  # [[x,y],...] 累计净值
    unit_raw = _read_js_array_var(text, "Data_netWorthTrend")  # [{x,y,...}] 单位净值
    latest_unit = (
        _to_number(unit_raw[-1].get("y"))
        if (isinstance(unit_raw, list) and unit_raw and isinstance(unit_raw[-1], dict))
        else None
    )

    def _points(rows: list[Any], getter: Any) -> list[dict[str, Any]]:
        by_date: dict[str, float] = {}
        for row in rows:
            x, y = getter(row)
            nav = _to_number(y)
            if x is None or nav is None or nav <= 0:
                continue
            date = _format_timestamp_date(x)
            if date:
                by_date[date] = nav
        return [{"date": d, "close": c} for d, c in sorted(by_date.items())]

    if isinstance(ac_raw, list) and ac_raw:
        ac_points = _points(ac_raw, lambda r: (r[0], r[1]) if isinstance(r, list) and len(r) >= 2 else (None, None))
        if not ac_points:
            return []
        latest_ac = ac_points[-1]["close"]
        factor = (latest_unit / latest_ac) if (latest_unit and latest_ac) else 1.0
        return [{"date": p["date"], "close": round(p["close"] * factor, 4)} for p in ac_points]
    if isinstance(unit_raw, list) and unit_raw:
        return _points(unit_raw, lambda r: (r.get("x"), r.get("y")) if isinstance(r, dict) else (None, None))
    return []


class EastmoneyProvider:
    """行情 + K线 + 基本面。实现 MarketDataProvider / FundamentalDataProvider。"""

    async def bars(self, ref: InstrumentRef, limit: int = 250) -> list[Bar]:
        secid = eastmoney_secid(ref)
        url = (
            f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}"
            f"&klt=101&fqt=1&fields1=f1,f2&fields2=f51,f53,f56&beg=0&end=20500101&lmt={limit}"
        )
        return parse_kline(await _get_json(url))

    async def quote(self, ref: InstrumentRef) -> QuoteSnapshot:
        secid = eastmoney_secid(ref)
        url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f43,f58,f170"
        return parse_quote(await _get_json(url), source_url=url)

    async def snapshot(self, ref: InstrumentRef) -> FundamentalSnapshot:
        secid = eastmoney_secid(ref)
        fields = f"{_F_PE},{_F_PB},{_F_MKTCAP},{_F_ROE},{_F_REV_YOY},{_F_PROFIT_YOY},f57,f58"
        url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields={fields}"
        return parse_fundamentals(await _get_json(url), source_url=url)
