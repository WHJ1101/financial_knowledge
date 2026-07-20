"""东财 datacenter 宏观 Provider 解析测试（fixture 契约，不打真实接口）。"""

from __future__ import annotations

from datetime import UTC, datetime

from app.providers.eastmoney_macro import _SPEC, parse_datacenter
from app.providers.macro import filter_by_as_of

# 真实 datacenter CPI 响应形状（DESC）
_CPI_FIXTURE = {
    "result": {
        "data": [
            {"REPORT_DATE": "2026-06-01 00:00:00", "TIME": "2026年06月份", "NATIONAL_SAME": 1.0},
            {"REPORT_DATE": "2026-05-01 00:00:00", "TIME": "2026年05月份", "NATIONAL_SAME": 1.2},
            {"REPORT_DATE": "2026-04-01 00:00:00", "TIME": "2026年04月份", "NATIONAL_SAME": 1.2},
        ]
    }
}
_PMI_FIXTURE = {
    "result": {"data": [{"REPORT_DATE": "2026-06-01 00:00:00", "TIME": "2026年06月份", "MAKE_INDEX": 50.3}]}
}


def test_parse_cpi():
    obs = parse_datacenter(_CPI_FIXTURE, _SPEC["cpi"])
    assert len(obs) == 3
    assert obs[0].observation_period == "2026年06月份"
    assert obs[0].value == 1.0
    assert obs[0].unit == "%"
    # release_at = 报告期 + 45 天保守滞后
    assert obs[0].release_at == datetime(2026, 7, 16, tzinfo=UTC)


def test_parse_pmi_absolute():
    obs = parse_datacenter(_PMI_FIXTURE, _SPEC["pmi"])
    assert obs[0].value == 50.3
    assert obs[0].unit == "点"


def test_as_of_filters_unpublished():
    """时点口径：as_of 早于最新期发布时间 → 剔除该期，只留已发布的。"""
    obs = parse_datacenter(_CPI_FIXTURE, _SPEC["cpi"])
    # as_of=2026-07-01：6月数据(发布~7/16)未发布应剔除，5月(发布~6/15)保留
    filtered = filter_by_as_of(obs, datetime(2026, 7, 1, tzinfo=UTC))
    periods = [o.observation_period for o in filtered]
    assert "2026年06月份" not in periods  # 未发布，剔除
    assert "2026年05月份" in periods


def test_revision_hash_dedup():
    a = parse_datacenter(_CPI_FIXTURE, _SPEC["cpi"])
    b = parse_datacenter(_CPI_FIXTURE, _SPEC["cpi"])
    assert a[0].revision_hash == b[0].revision_hash
