"""M11.1 行情市场数据纯解析函数测试（fixture 契约测试，方案 §6.3）。

用旧 market-data.js 真实响应形状 fixture，不打真实接口。字段口径与旧 JS 严格对齐。
"""

from __future__ import annotations

from app.providers.eastmoney import (
    classify_market_from_secid,
    classify_security,
    extract_security_code,
    is_exchange_fund_code,
    is_otc_fund_secid,
    parse_eastmoney_fund_page,
    parse_exchange_quote,
    parse_index_list,
    parse_search,
    parse_tiantian_fund,
)

# ---- 搜索建议 ----

_SEARCH_FIXTURE = {
    "QuotationCodeTable": {
        "Data": [
            {"Code": "301308", "Name": "江波龙", "QuoteID": "0.301308", "Classify": "AStock"},
            {"Code": "00700", "Name": "腾讯控股", "QuoteID": "116.00700", "Classify": "HKStock"},
            {"Code": "AAPL", "Name": "苹果", "QuoteID": "105.AAPL", "Classify": "USStock"},
            {"Code": "512480", "Name": "半导体ETF", "QuoteID": "1.512480", "Classify": "Fund"},
            {"Code": "014662", "Name": "某场外基金", "QuoteID": "150.014662", "Classify": "OTCFUND"},
            {"Code": "00100", "Name": "MINIMAX-W", "QuoteID": "116.00100", "Classify": "Warrant"},
        ]
    }
}


def test_parse_search():
    results = parse_search(_SEARCH_FIXTURE)
    assert len(results) == 6
    assert results[0] == {"code": "301308", "name": "江波龙", "market": "A股", "secid": "0.301308"}
    assert results[1]["market"] == "港股"
    assert results[2]["market"] == "美股"
    assert results[3]["market"] == "ETF"  # 512480 场内基金代码
    assert results[4]["market"] == "基金"  # OTCFUND
    assert results[5]["market"] == "港股"  # 港股涡轮不能默认成美股


def test_parse_search_empty():
    assert parse_search({}) == []
    assert parse_search({"QuotationCodeTable": {"Data": None}}) == []


def test_classify_helpers():
    assert is_exchange_fund_code("512480") is True
    assert is_exchange_fund_code("014662") is False
    assert extract_security_code("150.014662") == "014662"
    assert extract_security_code("无代码") == ""
    assert is_otc_fund_secid("150.014662") is True
    assert is_otc_fund_secid("0.301308") is False
    assert classify_security({"Classify": "Fund", "Code": "014662"}) == "基金"
    assert classify_market_from_secid("116", "00700") == "港股"
    assert classify_market_from_secid("105", "AAPL") == "美股"
    assert classify_market_from_secid("1", "603986") == "A股"


# ---- 指数快照（push2 ulist）----

_INDEX_FIXTURE = {
    "data": {
        "diff": [
            {"f2": 312050, "f3": 152, "f6": 28000000000, "f12": "000001", "f14": "上证指数"},
            {"f2": "-", "f3": "-", "f6": "-", "f12": "NDX", "f14": "纳斯达克100"},
        ]
    }
}


def test_parse_index_list():
    indices = parse_index_list(_INDEX_FIXTURE)
    assert len(indices) == 2
    assert indices[0]["code"] == "000001"
    assert indices[0]["level"] == "3120.50"  # 312050 / 100
    assert indices[0]["changePct"] == "1.52"  # 152 / 100
    assert indices[0]["volume"] == 28000000000
    # "-" → None（对齐旧 item.f2 === "-" ? null）
    assert indices[1]["level"] is None
    assert indices[1]["changePct"] is None
    assert indices[1]["volume"] is None


def test_parse_index_list_empty():
    assert parse_index_list({"data": None}) == []
    assert parse_index_list({}) == []


# ---- 交易所行情（gtimg GBK ~ 分隔）----


def _gtimg_line(price: str, prev: str) -> str:
    # gtimg 格式：v_sh600000="1~名称~600000~现价~昨收~开盘~...~最高(33)~最低(34)~..."
    parts = ["1", "浦发银行", "600000", price, prev, "10.00"] + ["0"] * 27 + ["10.50", "9.80"]
    return "~".join(parts)


def test_parse_exchange_quote():
    text = _gtimg_line("10.20", "10.00")
    q = parse_exchange_quote(text, "1.600000")
    assert q is not None
    assert q["name"] == "浦发银行"
    assert q["price"] == 10.20
    assert q["changePct"] == "2.00"  # (10.20-10.00)/10.00*100
    assert q["high"] == 10.50
    assert q["low"] == 9.80
    assert q["source"] == "exchange"
    assert q["market"] == "A股"


def test_parse_exchange_quote_short():
    assert parse_exchange_quote("1~2~3", "1.600000") is None
    assert parse_exchange_quote(_gtimg_line("10", "10"), "1.") is None  # 无 code


# ---- 场外基金（天天 JSONP / 东财净值页）----


def test_parse_tiantian_fund_estimate():
    text = (
        'jsonpgz({"fundcode":"014662","name":"测试基金","jzrq":"2026-07-14",'
        '"dwjz":"1.2000","gsz":"1.2500","gszzl":"4.17","gztime":"2026-07-15 15:00"});'
    )
    q = parse_tiantian_fund(text)
    assert q is not None
    assert q["price"] == 1.25  # gsz 估算净值优先
    assert q["changePct"] == "4.17"
    assert q["source"] == "fund-estimate"
    assert q["nav"] == 1.20  # dwjz 最新净值
    assert q["navDate"] == "2026-07-14"


def test_parse_tiantian_fund_nav_fallback():
    text = 'jsonpgz({"name":"无估算","jzrq":"2026-07-14","dwjz":"2.0000"});'
    q = parse_tiantian_fund(text)
    assert q is not None
    assert q["price"] == 2.00  # 无 gsz → dwjz
    assert q["source"] == "fund-nav"


def test_parse_tiantian_fund_null():
    assert parse_tiantian_fund("jsonpgz(null);") is None
    assert parse_tiantian_fund("") is None


def test_parse_eastmoney_fund_page():
    # Data_netWorthTrend 末点 x=毫秒时间戳, y=单位净值, equityReturn=涨跌
    text = (
        'var fS_name = "东财测试基金";'
        'var Data_netWorthTrend = [{"x":1751328000000,"y":1.5,"equityReturn":0.5},'
        '{"x":1751414400000,"y":1.53,"equityReturn":2.0}];'
    )
    q = parse_eastmoney_fund_page(text, "014662")
    assert q is not None
    assert q["name"] == "东财测试基金"
    assert q["price"] == 1.53
    assert q["changePct"] == "2.00"
    assert q["source"] == "fund-nav"
    assert q["nav"] == 1.53


def test_parse_eastmoney_fund_page_empty():
    assert parse_eastmoney_fund_page('var fS_name = "x";', "014662") is None
