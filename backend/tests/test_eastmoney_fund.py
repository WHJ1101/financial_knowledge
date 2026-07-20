"""东财基金画像 Provider 解析契约测试。"""

from __future__ import annotations

from app.providers.eastmoney_fund import parse_fund_profile

_FUND_PROFILE_FIXTURE = r'''
var fS_name = "永赢先锋半导体智选混合发起A";
var fS_code = "025208";
var syl_1n="";
var syl_6y="43.34";
var syl_3y="27.2";
var syl_1y="-11.5";
var Data_fluctuationScale = {
  "categories":["2025-12-31","2026-03-31"],
  "series":[{"y":6.90,"mom":"1155.10%"},{"y":14.45,"mom":"109.40%"}]
};
var Data_assetAllocation = {
  "series":[
    {"name":"股票占净比","data":[94.6,67.44]},
    {"name":"债券占净比","data":[0,0]},
    {"name":"现金占净比","data":[6.04,36.52]}
  ],
  "categories":["2025-12-31","2026-03-31"]
};
var Data_performanceEvaluation = {"avr":"75.55","categories":["选证能力","收益率"],"data":[65.8,89.2]};
var Data_currentFundManager = [{
  "name":"张海啸","star":4,"workTime":"3年又49天",
  "fundSize":"236.86亿(8只基金)","power":{"avr":"75.55"}
}];
var stockCodesNew = ["106.TSM","105.MU"];
'''


def test_parse_fund_profile_uses_fund_metrics_instead_of_stock_valuation() -> None:
    snapshot = parse_fund_profile(_FUND_PROFILE_FIXTURE, source_url="https://fund.example/025208.js")

    assert snapshot.kind == "fund_profile"
    assert snapshot.name == "永赢先锋半导体智选混合发起A"
    assert snapshot.return_1m_pct == -11.5
    assert snapshot.return_3m_pct == 27.2
    assert snapshot.return_6m_pct == 43.34
    assert snapshot.return_1y_pct is None
    assert snapshot.scale_billion == 14.45
    assert snapshot.scale_as_of == "2026-03-31"
    assert snapshot.stock_ratio_pct == 67.44
    assert snapshot.cash_ratio_pct == 36.52
    assert snapshot.allocation_as_of == "2026-03-31"
    assert snapshot.managers[0]["name"] == "张海啸"
    assert snapshot.performance_score == 75.55
    assert snapshot.top_holdings == [
        {"secid": "106.TSM", "code": "TSM", "name": ""},
        {"secid": "105.MU", "code": "MU", "name": ""},
    ]
    assert "权重" in snapshot.top_holdings_note
    assert snapshot.data_gap is None


def test_parse_fund_profile_marks_empty_payload_as_gap() -> None:
    snapshot = parse_fund_profile('var fS_name = "空基金";')

    assert snapshot.name == "空基金"
    assert snapshot.data_gap == "基金画像接口无数据"
