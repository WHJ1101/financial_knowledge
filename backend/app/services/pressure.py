"""板块压力指数纯计算（移植自 lib/pressure-index.js，方案 §13/M4）。

全程纯函数、无 I/O，便于单测。语义与原 JS 版严格对齐（滚动百分位、四象限状态、跨阈值）。
"""

from __future__ import annotations

from typing import Any

PERCENTILE_WINDOW = 120  # 滚动百分位窗口（交易日）
RETURN_PERIOD = 5  # 背离分项的收益率回看期
VOLUME_MA_PERIOD = 20  # 量比的均量窗口
SERIES_POINTS = 30  # 近 N 日综合分序列长度
UPPER_THRESHOLD = 70  # 上穿报警阈值（百分位）
LOWER_THRESHOLD = 30  # 下穿报警阈值（百分位）

Bar = dict[str, Any]  # {date, close, volume}
Point = dict[str, Any]


def _round1(n: float | None) -> float | None:
    return None if n is None else round(n * 10) / 10


def compute_theme_pressure(bars: dict[str, list[Bar]], config: dict[str, Any]) -> dict[str, Any]:
    """主入口：bars 为 {secid: [bar]} 映射，config 为主题定义。"""
    subs = config.get("subs") or []
    if not subs:
        return _empty_result(config)

    sub_series = [
        {"key": sub["key"], "label": sub["label"], "sub": sub, "danger": _build_danger_series(sub, bars)}
        for sub in subs
    ]
    for item in sub_series:
        item["scores"] = rolling_percentile_scores(item["danger"])

    composite_series = _build_composite_series(sub_series)
    if not composite_series:
        return _empty_result(config)

    latest = composite_series[-1]

    def score_by_date(scores: list[Point]) -> Point | None:
        return next((p for p in scores if p["date"] == latest["date"]), None)

    def raw_by_date(danger: list[Point]) -> Point | None:
        return next((p for p in danger if p["date"] == latest["date"]), None)

    sub_scores = []
    for item in sub_series:
        point = score_by_date(item["scores"])
        raw_point = raw_by_date(item["danger"])
        sub_scores.append(
            {
                "key": item["key"],
                "label": item["label"],
                "score": _round1(point["score"]) if point and point["score"] is not None else None,
                "rawText": _describe_raw(item["sub"], raw_point["value"] if raw_point else None),
            }
        )

    volume_sub = next((s for s in sub_scores if s["key"] == config.get("volumeKey")), sub_scores[0])

    return {
        "date": latest["date"],
        "composite": _round1(latest["composite"]),
        "subScores": sub_scores,
        "series30": [
            {"date": p["date"], "composite": _round1(p["composite"])} for p in composite_series[-SERIES_POINTS:]
        ],
        "status": build_status(composite_series, volume_sub.get("score") if volume_sub else None),
        "crossing": detect_crossing(composite_series),
    }


def _build_danger_series(sub: dict[str, Any], bars: dict[str, list[Bar]]) -> list[Point]:
    kind = sub.get("kind")
    if kind == "volumeRatio":
        return _volume_ratio_series(bars.get(sub["secid"], []))
    if kind == "underperformance":
        return _underperformance_series(bars.get(sub["sector"], []), bars.get(sub["baseline"], []))
    if kind == "spread":
        return _spread_series(bars.get(sub["high"], []), bars.get(sub["low"], []))
    return []


def _volume_ratio_series(bars_list: list[Bar]) -> list[Point]:
    out: list[Point] = []
    for i in range(VOLUME_MA_PERIOD - 1, len(bars_list)):
        total = 0.0
        ok = True
        for j in range(i - VOLUME_MA_PERIOD + 1, i + 1):
            v = bars_list[j].get("volume")
            if v is None:
                ok = False
                break
            total += v
        ma = total / VOLUME_MA_PERIOD
        v = bars_list[i].get("volume")
        if not ok or not ma or v is None:
            continue
        out.append({"date": bars_list[i]["date"], "value": v / ma})
    return out


def _underperformance_series(sector_bars: list[Bar], baseline_bars: list[Bar]) -> list[Point]:
    aligned = _align_by_date(sector_bars, baseline_bars)
    out: list[Point] = []
    for i in range(RETURN_PERIOD, len(aligned)):
        ret_sector = _return_rate(aligned[i]["a"], aligned[i - RETURN_PERIOD]["a"])
        ret_baseline = _return_rate(aligned[i]["b"], aligned[i - RETURN_PERIOD]["b"])
        if ret_sector is None or ret_baseline is None:
            continue
        out.append({"date": aligned[i]["date"], "value": ret_baseline - ret_sector})
    return out


def _spread_series(high_bars: list[Bar], low_bars: list[Bar]) -> list[Point]:
    return [{"date": p["date"], "value": p["a"] - p["b"]} for p in _align_by_date(high_bars, low_bars)]


def _align_by_date(bars_a: list[Bar], bars_b: list[Bar]) -> list[Point]:
    map_b = {b["date"]: b["close"] for b in bars_b}
    return [{"date": a["date"], "a": a["close"], "b": map_b[a["date"]]} for a in bars_a if a["date"] in map_b]


def _return_rate(current: float | None, prev: float | None) -> float | None:
    if current is None or prev is None or not prev:
        return None
    return current / prev - 1


def rolling_percentile_scores(series: list[Point], window: int = PERCENTILE_WINDOW) -> list[Point]:
    out: list[Point] = []
    for i in range(len(series)):
        start = max(0, i - window + 1)
        window_vals = [series[j]["value"] for j in range(start, i + 1)]
        out.append({"date": series[i]["date"], "score": percentile_rank(window_vals, series[i]["value"])})
    return out


def percentile_rank(values: list[float], current: float) -> float | None:
    if not values:
        return None
    count_le = sum(1 for v in values if v <= current)
    return (count_le / len(values)) * 100


def _build_composite_series(sub_score_series: list[dict[str, Any]]) -> list[Point]:
    if not sub_score_series:
        return []
    maps = [{p["date"]: p["score"] for p in s["scores"]} for s in sub_score_series]
    composite: list[Point] = []
    for point in sub_score_series[0]["scores"]:
        total = 0.0
        ok = True
        for m in maps:
            score = m.get(point["date"])
            if score is None:
                ok = False
                break
            total += score
        if ok:
            composite.append({"date": point["date"], "composite": total / len(maps)})
    return composite


def build_status(composite_series: list[Point], volume_score: float | None) -> str:
    if len(composite_series) < 2:
        return "数据不足"
    last = composite_series[-1]["composite"]
    prev = composite_series[-2]["composite"]
    composite_up = last > prev
    volume_high = (volume_score if volume_score is not None else 50) >= 50
    if composite_up and volume_high:
        return "放量下跌，压力抬升中"
    if not composite_up and not volume_high:
        return "低量企稳，压力回落"
    if composite_up and not volume_high:
        return "缩量阴跌"
    return "放量反弹待确认"


def detect_crossing(composite_series: list[Point]) -> str | None:
    if len(composite_series) < 2:
        return None
    last = composite_series[-1]["composite"]
    prev = composite_series[-2]["composite"]
    if prev < UPPER_THRESHOLD <= last:
        return "up-70"
    if prev > LOWER_THRESHOLD >= last:
        return "down-30"
    return None


def _describe_raw(sub: dict[str, Any], value: float | None) -> str:
    if value is None:
        return "数据不足"
    kind = sub.get("kind")
    if kind == "volumeRatio":
        return f"量比 {value:.2f}"
    if kind == "underperformance":
        return f"5日超额 {-value * 100:.1f}%"
    if kind == "spread":
        return f"价差 {value:.2f}"
    return str(value)


def _empty_result(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "date": None,
        "composite": None,
        "subScores": [
            {"key": s["key"], "label": s["label"], "score": None, "rawText": "数据不足"}
            for s in (config.get("subs") or [])
        ],
        "series30": [],
        "status": "数据不足",
        "crossing": None,
    }
