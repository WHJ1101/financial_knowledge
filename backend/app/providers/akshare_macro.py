"""akshare 宏观 Adapter（方案 §6.2，ADR-011）——金十数据源。

★修正（原用统计局源 macro_china_cpi 无发布时间，臆断为"不带发布日"是错误）：
改用金十源 macro_china_*_monthly/_yearly 系列，统一字段 商品/日期/今值/预测值/前值，
其中「日期」即实际发布日 → 原生 release_at，符合时点口径铁律，无需滞后估算。

akshare 只在此文件出现；业务层依赖 MacroDataProvider Protocol（ADR-011）。
"""

from __future__ import annotations

import hashlib
import math
from datetime import UTC, datetime
from typing import Any

from app.providers.macro import (
    MacroObservationDTO,
    MacroSeriesRef,
    MacroSeriesSnapshot,
    filter_by_as_of,
)

# 指标 → (金十源 akshare 函数, 单位, 同比/环比/绝对值)。字段统一 商品/日期/今值/预测值/前值。
_SPEC: dict[str, dict[str, str]] = {
    "cpi": {"fn": "macro_china_cpi_monthly", "unit": "%", "vtype": "mom"},  # CPI 月率
    "ppi": {"fn": "macro_china_ppi_yearly", "unit": "%", "vtype": "yoy"},
    "pmi": {"fn": "macro_china_pmi_yearly", "unit": "点", "vtype": "absolute"},
    "gdp": {"fn": "macro_china_gdp_yearly", "unit": "%", "vtype": "yoy"},
    "m2": {"fn": "macro_china_m2_yearly", "unit": "%", "vtype": "yoy"},
}


def _revision_hash(period: str, value: float | None) -> str:
    return hashlib.sha256(f"{period}|{value}".encode()).hexdigest()[:16]


def parse_jin10(records: list[dict[str, Any]], unit: str) -> list[MacroObservationDTO]:
    """解析金十源记录（纯函数，fixture 测试）。

    「日期」=发布日=release_at + observation_period；「今值」=value（NaN→None，剔除未发布行）。
    """
    out: list[MacroObservationDTO] = []
    for rec in records:
        date_str = str(rec.get("日期", "")).strip()
        if not date_str:
            continue
        raw_value = rec.get("今值")
        # NaN（未来待发布行）或空 → value=None
        if raw_value in (None, "", "-") or (isinstance(raw_value, float) and math.isnan(raw_value)):
            value: float | None = None
        else:
            try:
                value = float(raw_value)
            except (ValueError, TypeError):
                value = None

        try:
            release_at: datetime | None = datetime.fromisoformat(date_str).replace(tzinfo=UTC)
        except ValueError:
            release_at = None

        out.append(
            MacroObservationDTO(
                observation_period=date_str,
                release_at=release_at,
                value=value,
                unit=unit,
                revision_hash=_revision_hash(date_str, value),
                raw=dict(rec),
                data_gap=None if (release_at and value is not None) else "未发布或日期解析失败",
            )
        )
    return out


class AksharesMacroProvider:
    """实现 MacroDataProvider。金十源，原生带发布日期（方案 §6.1）。"""

    def _fetch_records(self, code: str) -> list[dict[str, Any]]:
        import akshare as ak  # 局部 import：仅此 adapter 依赖 akshare

        df = getattr(ak, _SPEC[code]["fn"])()
        records: list[dict[str, Any]] = df.to_dict("records")
        return records

    async def series(self, ref: MacroSeriesRef, as_of: datetime) -> MacroSeriesSnapshot:
        import anyio

        spec = _SPEC.get(ref.code)
        if spec is None:
            return MacroSeriesSnapshot(ref=ref, observations=[], as_of=as_of, data_gap=f"未知指标 {ref.code}")
        try:
            records = await anyio.to_thread.run_sync(self._fetch_records, ref.code)
        except Exception as e:  # noqa: BLE001 —— adapter 边界，抓取异常降级
            return MacroSeriesSnapshot(ref=ref, observations=[], as_of=as_of, data_gap=f"akshare 抓取失败: {e}")

        # 金十源带 release_at → 时点过滤有效剔除未发布（as_of 之后）的观测
        observations = [o for o in parse_jin10(records, spec["unit"]) if o.value is not None]
        filtered = filter_by_as_of(observations, as_of)
        gap = None if filtered else "无 release_at<=as_of 的已发布观测"
        return MacroSeriesSnapshot(ref=ref, observations=filtered, as_of=as_of, data_gap=gap)


def to_orm_rows(snapshot: MacroSeriesSnapshot, series_id: str) -> list[dict[str, Any]]:
    """把快照观测转成 macro_observations 落库行（供 worker 刷新任务用）。"""
    now = datetime.now(UTC)
    return [
        {
            "series_id": series_id,
            "observation_period": obs.observation_period,
            "release_at": obs.release_at,
            "value": obs.value,
            "unit": obs.unit,
            "source": snapshot.ref.source,
            "retrieved_at": now,
            "revision_hash": obs.revision_hash,
            "raw_payload": obs.raw,
        }
        for obs in snapshot.observations
    ]
