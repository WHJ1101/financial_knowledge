"""组合分析纯计算（移植 src/lib/portfolio-analysis.js，方案 §11.4 补齐）。

buildHoldings：持仓 + 行情 → 带盈亏/权重的持仓行。
buildAnalysis：市场/资产/风险分布 + 收益归因 + 健康度 + 底层主题穿透。
全程纯函数、无 I/O，便于单测；口径与旧 JS 版严格对齐。
"""

from __future__ import annotations

import re
from typing import Any

CHART_COLORS = ["#2563eb", "#0f766e", "#dc2626", "#7c3aed", "#d97706", "#0891b2", "#64748b", "#be185d"]


def risk_level(text: str | None = "") -> str:
    t = (text or "").strip()
    if not t:
        return "low"
    if re.search(r"低风险|风险可控|相对稳健|暂无明显风险", t):
        return "low"
    if re.search(r"高风险|极高风险|重大风险|退市|爆仓|暴雷|资不抵债|流动性枯竭", t):
        return "high"
    if re.search(r"止损|跌破|失效|威胁|替代|下调|回调|波动|不及预期|需求|政策|竞争|估值", t):
        return "medium"
    return "low"


def build_holdings(rows: list[dict[str, Any]], quotes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """持仓行 + 行情 → 带 marketValue/pnl/pnlPct/weight 的行（移植 buildHoldings）。"""
    out: list[dict[str, Any]] = []
    for p in rows:
        quote = quotes.get(p["code"])
        price = float(quote["price"]) if quote and quote.get("price") else None
        shares = float(p.get("shares") or 0)
        cost = float(p.get("cost") or 0)
        has_cost = cost > 0
        has_price = bool(price and price > 0)
        cost_value = shares * cost if has_cost else 0.0
        market_value = shares * (price if price else (cost if has_cost else 0.0))
        pnl = (market_value - cost_value) if (has_cost and has_price) else None
        pnl_pct = (pnl / cost_value * 100) if (pnl is not None and cost_value) else None
        out.append(
            {
                **p,
                "shares": shares,
                "cost": cost,
                "hasCost": has_cost,
                "hasPrice": has_price,
                "market": (quote.get("market") if quote else None) or p.get("market") or "",
                "price": price,
                "changePct": quote.get("changePct") if quote else None,
                "quoteSource": quote.get("sourceLabel") if quote else None,
                "costValue": cost_value,
                "marketValue": market_value,
                "pnl": pnl,
                "pnlPct": pnl_pct,
            }
        )
    total = sum(r["marketValue"] for r in out)
    for r in out:
        r["weight"] = (r["marketValue"] / total * 100) if total else 0.0
    return out


def build_overview(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    """概览：总市值/浮动盈亏/AI 待处理/高风险（移植 getOverview，持仓维度）。"""
    cost = sum(r["costValue"] for r in holdings)
    market_value = sum(r["marketValue"] for r in holdings)
    costed_mv = sum(r["marketValue"] for r in holdings if r["hasCost"])
    pnl = costed_mv - cost
    analyzing = sum(1 for r in holdings if r.get("analysisStatus") in ("analyzing", "failed"))
    high_risk = sum(1 for r in holdings if risk_level(r.get("risk")) == "high")
    return {
        "marketValue": market_value,
        "pnl": pnl,
        "pnlPct": (pnl / cost * 100) if cost else 0.0,
        "analyzingCount": analyzing,
        "highRiskCount": high_risk,
        "positionCount": len(holdings),
    }


def _classify_market(row: dict[str, Any]) -> str:
    text = f"{row.get('name', '')} {row.get('code', '')} {row.get('market', '')}".lower()
    if re.search(r"债|货币|现金|增利|短债|纯债", text):
        return "固收/现金"
    if re.search(r"港股|恒生|香港|h股", text):
        return "港股"
    if re.search(r"美股|纳斯达克|标普|sp500|s&p|qdii|全球|海外|美元", text):
        return "美股/海外"
    if re.search(r"科创|半导体|芯片|集成电路|创业", text):
        return "A股科创成长"
    if re.search(r"中证|沪深|上证|深证|创业板|a股|etf|基金", text):
        return "A股宽基/基金"
    return row.get("market") or "其他"


def _classify_asset(row: dict[str, Any]) -> str:
    text = f"{row.get('name', '')} {row.get('code', '')} {row.get('market', '')}".lower()
    if re.search(r"债|货币|现金|增利|短债|纯债", text):
        return "固收基金"
    if re.search(r"qdii|全球|海外|纳斯达克|标普", text):
        return "QDII / 海外基金"
    if re.search(r"etf|联接|指数|中证|沪深|上证|深证|创业板|科创", text):
        return "指数 / ETF"
    if re.search(r"基金|混合|股票型", text):
        return "主动基金"
    if re.search(r"a股|港股|美股|股票", text):
        return "股票"
    return row.get("market") or "其他"


def _risk_bucket(row: dict[str, Any]) -> str:
    return {"high": "高风险", "medium": "中风险", "low": "低风险"}[risk_level(row.get("risk"))]


def _group_rows(holdings: list[dict[str, Any]], get_label: Any, total: float) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = {}
    for row in holdings:
        label = get_label(row)
        cur = agg.setdefault(label, {"label": label, "value": 0.0, "count": 0})
        cur["value"] += row["marketValue"]
        cur["count"] += 1
    rows = [{**r, "weight": (r["value"] / total * 100) if total else 0.0} for r in agg.values()]
    return sorted(rows, key=lambda r: r["value"], reverse=True)


# ---- 底层主题穿透（规则估算，移植 inferThemes/buildThemeRows）----


def _infer_themes(row: dict[str, Any]) -> list[tuple[str, float]]:
    text = f"{row.get('name', '')} {row.get('code', '')} {row.get('market', '')}".lower()
    themes: list[tuple[str, float]] = []
    if re.search(r"光模块|光通信|cpo|光器件", text):
        themes.append(("光模块/CPO", 1.0))
    if re.search(r"dram|hbm|内存", text):
        themes.append(("DRAM/HBM", 1.0))
    if re.search(r"nand|存储|闪存", text):
        themes.append(("NAND/存储", 1.0))
    if re.search(r"半导体|芯片|集成电路", text):
        themes += [
            ("芯片/半导体", 0.58),
            ("AI 算力/科技", 0.18),
            ("DRAM/HBM", 0.08),
            ("NAND/存储", 0.06),
            ("科创成长", 0.1),
        ]
    if re.search(r"科创|创业", text):
        themes += [("科创成长", 0.46), ("芯片/半导体", 0.24), ("AI 算力/科技", 0.18), ("高端制造", 0.12)]
    if re.search(r"纳斯达克|nasdaq|全球科技|科技先锋", text):
        themes += [("美股科技", 0.48), ("AI 算力/科技", 0.27), ("芯片/半导体", 0.14), ("海外资产", 0.11)]
    if re.search(r"标普|sp500|s&p", text):
        themes += [("美股宽基", 0.7), ("海外资产", 0.2), ("AI 算力/科技", 0.1)]
    if re.search(r"中证500|500指数", text):
        themes.append(("A股中盘宽基", 1.0))
    if re.search(r"上证50|沪深300|中证1000|全a|a500|深证100", text):
        themes.append(("A股宽基", 1.0))
    if re.search(r"债|货币|现金|增利|短债|纯债", text):
        themes.append(("固收/现金", 1.0))
    if re.search(r"医药|医疗|创新药", text):
        themes.append(("医药医疗", 1.0))
    if re.search(r"消费|白酒|食品", text):
        themes.append(("消费", 1.0))
    return themes or [("其他/待穿透", 1.0)]


def _build_theme_rows(holdings: list[dict[str, Any]], total: float) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = {}
    for row in holdings:
        themes = _infer_themes(row)
        weight_sum = sum(w for _, w in themes) or 1.0
        for label, w in themes:
            value = row["marketValue"] * w / weight_sum
            cur = agg.setdefault(label, {"label": label, "value": 0.0, "contributors": []})
            cur["value"] += value
            cur["contributors"].append({"name": row.get("name"), "value": value})
    rows = []
    for r in agg.values():
        r["contributors"] = sorted(r["contributors"], key=lambda c: c["value"], reverse=True)
        r["weight"] = (r["value"] / total * 100) if total else 0.0
        rows.append(r)
    return sorted(rows, key=lambda r: r["value"], reverse=True)[:10]


def _build_attribution(holdings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [r for r in holdings if r["pnl"] is not None]
    rows.sort(key=lambda r: abs(r["pnl"]), reverse=True)
    return [
        {"label": r.get("name"), "value": r["pnl"], "detailPct": r["pnlPct"], "tone": "up" if r["pnl"] >= 0 else "down"}
        for r in rows[:6]
    ]


def _build_health(
    max_weight: float, top5: float, high_risk_w: float, price_cov: float, cost_cov: float, theme_cov: float
) -> dict[str, Any]:
    score = 100.0
    if max_weight > 35:
        score -= min(22, (max_weight - 35) * 0.8)
    if top5 > 80:
        score -= min(18, (top5 - 80) * 0.8)
    if high_risk_w > 35:
        score -= min(20, (high_risk_w - 35) * 0.7)
    if price_cov < 90:
        score -= min(18, (90 - price_cov) * 0.5)
    if cost_cov < 90:
        score -= min(14, (90 - cost_cov) * 0.35)
    if theme_cov < 55:
        score -= min(12, (55 - theme_cov) * 0.25)
    health = max(0, round(score))
    tone = "good" if health >= 80 else "warn" if health >= 60 else "bad"
    label = "结构稳健" if health >= 80 else "需要复核" if health >= 60 else "风险偏高"
    alerts: list[dict[str, str]] = []
    if max_weight > 35:
        alerts.append({"text": f"最大单仓 {max_weight:.1f}%，集中度偏高", "tone": "warn"})
    if top5 > 80:
        alerts.append({"text": f"前五持仓 {top5:.1f}%，组合分散度不足", "tone": "warn"})
    if high_risk_w > 35:
        alerts.append({"text": f"高风险仓位 {high_risk_w:.1f}%，需复核止损线", "tone": "bad"})
    if price_cov < 90:
        alerts.append({"text": f"行情覆盖 {price_cov:.1f}%，部分市值待更新", "tone": "warn"})
    if cost_cov < 90:
        alerts.append({"text": f"成本覆盖 {cost_cov:.1f}%，收益归因不完整", "tone": "warn"})
    if theme_cov < 55:
        alerts.append({"text": f"主题识别 {theme_cov:.1f}%，底仓穿透待增强", "tone": "muted"})
    if not alerts:
        alerts.append({"text": "仓位、风险和数据覆盖暂无明显异常", "tone": "good"})
    return {
        "healthScore": health,
        "healthTone": tone,
        "healthLabel": label,
        "healthAlerts": alerts,
        "healthFactors": [
            {"label": "最大单仓", "value": max_weight, "percent": min(100, max_weight)},
            {"label": "前五集中", "value": top5, "percent": min(100, top5)},
            {"label": "高风险仓位", "value": high_risk_w, "percent": min(100, high_risk_w)},
            {"label": "数据覆盖", "value": min(price_cov, cost_cov), "percent": min(price_cov, cost_cov)},
        ],
    }


def build_analysis(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    """组合分析（移植 buildPortfolioAnalysis）：分布 + 归因 + 健康度 + 主题穿透。"""
    total = sum(r["marketValue"] for r in holdings)
    total_cost = sum(r["costValue"] for r in holdings)
    costed_mv = sum(r["marketValue"] for r in holdings if r["hasCost"])
    pnl = costed_mv - total_cost
    count = len(holdings)
    if not count:
        return {"count": 0}
    by_value = sorted(holdings, key=lambda r: r["marketValue"], reverse=True)
    largest = by_value[0]
    max_weight = largest.get("weight", 0)
    top5 = (sum(r["marketValue"] for r in by_value[:5]) / total * 100) if total else 0.0
    price_cov = sum(1 for r in holdings if r["hasPrice"]) / count * 100
    cost_cov = sum(1 for r in holdings if r["hasCost"]) / count * 100
    high_risk = [r for r in holdings if risk_level(r.get("risk")) == "high"]
    high_risk_w = (sum(r["marketValue"] for r in high_risk) / total * 100) if total else 0.0
    market_rows = _group_rows(holdings, _classify_market, total)
    asset_rows = _group_rows(holdings, _classify_asset, total)
    risk_rows = _group_rows(holdings, _risk_bucket, total)
    theme_rows = _build_theme_rows(holdings, total)
    theme_known = sum(r["value"] for r in theme_rows if r["label"] != "其他/待穿透")
    theme_cov = (theme_known / total * 100) if total else 0.0
    health = _build_health(max_weight, top5, high_risk_w, price_cov, cost_cov, theme_cov)
    return {
        "count": count,
        "totalMarket": total,
        "totalCost": total_cost,
        "pnl": pnl,
        "pnlPct": (pnl / total_cost * 100) if total_cost else 0.0,
        "largestHolding": {"name": largest.get("name"), "weight": max_weight},
        "maxWeight": max_weight,
        "top5Weight": top5,
        "topMarketWeight": market_rows[0]["weight"] if market_rows else 0.0,
        "topAssetWeight": asset_rows[0]["weight"] if asset_rows else 0.0,
        "highRiskCount": len(high_risk),
        "highRiskWeight": high_risk_w,
        "priceCoverage": price_cov,
        "costCoverage": cost_cov,
        "themeCoverage": theme_cov,
        "marketRows": market_rows,
        "assetRows": asset_rows,
        "riskRows": risk_rows,
        "themeRows": theme_rows,
        "pnlRows": _build_attribution(holdings),
        **health,
    }
