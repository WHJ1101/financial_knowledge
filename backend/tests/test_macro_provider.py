"""akshare 金十源宏观 Provider 解析测试（fixture 契约，不打真实接口）。

★修正后：金十源字段 商品/日期/今值/预测值/前值，「日期」原生即 release_at。
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from app.providers.akshare_macro import parse_jin10
from app.providers.macro import MacroSeriesRef, filter_by_as_of

# 真实金十源响应形状（含未来待发布行 今值=NaN）
_JIN10_FIXTURE = [
    {"商品": "中国CPI月率报告", "日期": "2026-06-10", "今值": 0.1, "预测值": 0.2, "前值": -0.1},
    {"商品": "中国CPI月率报告", "日期": "2026-07-09", "今值": 0.3, "预测值": 0.3, "前值": 0.1},
    {"商品": "中国CPI月率报告", "日期": "2026-08-09", "今值": float("nan"), "预测值": float("nan"), "前值": 0.3},
]


def test_parse_jin10_has_release_date():
    obs = parse_jin10(_JIN10_FIXTURE, "%")
    assert len(obs) == 3
    # 「日期」原生即 release_at —— 无需滞后估算（这是金十源相对统计局源的关键优势）
    assert obs[0].release_at == datetime(2026, 6, 10, tzinfo=UTC)
    assert obs[0].value == 0.1
    assert obs[0].data_gap is None


def test_parse_jin10_nan_is_none():
    """未来待发布行 今值=NaN → value=None + data_gap。"""
    obs = parse_jin10(_JIN10_FIXTURE, "%")
    assert obs[2].value is None
    assert obs[2].data_gap is not None


def test_as_of_filter_with_native_release():
    """金十源 release_at 真实存在 → 时点过滤精确剔除未发布。"""
    obs = [o for o in parse_jin10(_JIN10_FIXTURE, "%") if o.value is not None]
    # as_of=2026-06-30：只有 6-10 已发布，7-09 未发布应剔除
    filtered = filter_by_as_of(obs, datetime(2026, 6, 30, tzinfo=UTC))
    assert len(filtered) == 1
    assert filtered[0].release_at == datetime(2026, 6, 10, tzinfo=UTC)


def test_no_lag_estimation_needed():
    """对照说明：金十源不需要东财 datacenter 那套「报告期+滞后天数」估算。"""
    obs = parse_jin10([{"商品": "x", "日期": "2026-05-15", "今值": 1.0}], "%")
    # release_at 直接等于数据里的日期，精确
    assert obs[0].release_at == datetime(2026, 5, 15, tzinfo=UTC)


def test_macro_series_ref():
    ref = MacroSeriesRef(source="jin10", code="cpi", region="CN")
    assert ref.source == "jin10"


def test_nan_helper_sanity():
    assert math.isnan(float("nan"))
