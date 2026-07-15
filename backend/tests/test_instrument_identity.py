"""证券身份规范化单测（方案 §4.1）。用真实存量样例断言。"""

from app.services.instrument_identity import merge_provider_id, normalize


def test_ashare_equity_by_market() -> None:
    r = normalize("SZ301308", "创业板")
    assert r is not None
    assert (r.exchange, r.asset_class, r.canonical_symbol) == ("SZSE", "equity", "301308")
    assert r.display_code == "SZ301308"


def test_star_market() -> None:
    r = normalize("688110", "科创板")
    assert r is not None
    assert (r.exchange, r.asset_class, r.canonical_symbol) == ("SSE", "equity", "688110")


def test_sh_main_board() -> None:
    r = normalize("603986", "沪市主板")
    assert r is not None
    assert (r.exchange, r.asset_class) == ("SSE", "equity")


def test_etf() -> None:
    r = normalize("159995", "ETF")
    assert r is not None
    assert (r.exchange, r.asset_class, r.canonical_symbol) == ("SZSE", "etf", "159995")


def test_otc_fund() -> None:
    r = normalize("014662", "基金")
    assert r is not None
    assert (r.exchange, r.asset_class, r.canonical_symbol) == ("OTC_FUND", "open_end_fund", "014662")


def test_us_stock() -> None:
    r = normalize("00100", "美股")
    assert r is not None
    assert (r.exchange, r.asset_class) == ("US", "us_stock")


def test_strip_eastmoney_prefix() -> None:
    r = normalize("0.159915", "ETF")
    assert r is not None
    assert r.canonical_symbol == "159915"


def test_unresolvable_returns_none() -> None:
    assert normalize("", "创业板") is None
    assert normalize("ABC", "未知市场") is None


def test_merge_provider_id() -> None:
    assert merge_provider_id({}, "OF.014662", "fund") == {"fund": "OF.014662"}
    assert merge_provider_id({}, "0.159915", "exchange") == {"eastmoney": "0.159915"}
    merged = merge_provider_id({"fund": "OF.007722"}, "150.007722", "exchange")
    assert merged == {"fund": "OF.007722", "eastmoney": "150.007722"}
