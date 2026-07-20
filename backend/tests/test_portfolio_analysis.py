"""组合分析纯函数测试（方案 §11.4）。

buildHoldings 盈亏/权重、分布分桶、健康度、主题穿透、收益归因，口径对齐旧 JS。
"""

from __future__ import annotations

from app.services.portfolio_analysis import (
    build_analysis,
    build_holdings,
    build_overview,
    risk_level,
)


def _holdings():
    rows = [
        {
            "id": "1",
            "code": "159995",
            "name": "芯片ETF华夏",
            "market": "ETF",
            "shares": 1000,
            "cost": 2.0,
            "risk": "高风险替代路线",
            "analysisStatus": "done",
        },
        {
            "id": "2",
            "code": "025208",
            "name": "永赢先锋半导体智选混合发起A",
            "market": "基金",
            "shares": 9000,
            "cost": 1.0,
            "risk": "波动",
            "analysisStatus": "done",
        },
        {
            "id": "3",
            "code": "024239",
            "name": "华夏全球科技先锋混合(QDII)C",
            "market": "基金",
            "shares": 5000,
            "cost": 1.5,
            "risk": "",
            "analysisStatus": "pending",
        },
    ]
    quotes = {
        "159995": {"price": 3.0, "market": "ETF"},
        "025208": {"price": 1.2},
        "024239": {"price": 2.0},
    }
    return build_holdings(rows, quotes)


def test_build_holdings_pnl_weight():
    h = build_holdings(
        [{"code": "X", "name": "N", "market": "A股", "shares": 100, "cost": 10}],
        {"X": {"price": 12}},
    )[0]
    assert h["marketValue"] == 1200
    assert h["pnl"] == 200  # (12-10)*100
    assert abs(h["pnlPct"] - 20.0) < 1e-9
    assert h["weight"] == 100.0  # 单一持仓


def test_build_holdings_no_price_uses_cost():
    h = build_holdings([{"code": "X", "name": "N", "market": "A股", "shares": 100, "cost": 10}], {})[0]
    assert h["marketValue"] == 1000  # 无行情用成本
    assert h["pnl"] is None  # 无现价 → 盈亏未知
    assert h["hasPrice"] is False


def test_overview():
    ov = build_overview(_holdings())
    assert ov["positionCount"] == 3
    assert ov["highRiskCount"] == 1  # 只有芯片ETF risk 命中高风险
    assert ov["marketValue"] > 0


def test_build_analysis_distributions():
    a = build_analysis(_holdings())
    assert a["count"] == 3
    # 市场分布：芯片ETF→A股科创成长, 半导体基金→A股科创成长, QDII→美股/海外
    labels = {r["label"] for r in a["marketRows"]}
    assert "美股/海外" in labels
    # 资产分布
    asset_labels = {r["label"] for r in a["assetRows"]}
    assert "指数 / ETF" in asset_labels or "QDII / 海外基金" in asset_labels
    # 风险分布含高风险
    assert any(r["label"] == "高风险" for r in a["riskRows"])
    # 主题穿透非空
    assert len(a["themeRows"]) >= 1
    # 收益归因按盈亏绝对值排序
    assert len(a["pnlRows"]) >= 1
    # 健康度字段齐全
    assert 0 <= a["healthScore"] <= 100
    assert a["healthTone"] in ("good", "warn", "bad")
    assert len(a["healthFactors"]) == 4


def test_build_analysis_empty():
    assert build_analysis([])["count"] == 0


def test_risk_level():
    assert risk_level("止损位跌破") == "medium"
    assert risk_level("存在重大退市风险") == "high"
    assert risk_level("需求波动") == "medium"
    assert risk_level("稳健") == "low"
    assert risk_level("") == "low"
