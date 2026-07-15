"""宏观数据 Provider（方案 §6.1/§6.2，akshare）。

时点口径铁律（§6.1）：series(ref, as_of) 只返 release_at<=as_of 的观测，杜绝未来数据。
release_at 无法确认 → data_gap，绝不用 retrieved_at 冒充（§6 必须项 6）。
akshare 只在 adapter 内部，业务层不直接 import akshare（ADR-011）。

解析纯函数（parse_*）用 DataFrame-like 记录列表做 fixture 契约测试，不打真实接口。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class MacroSeriesRef:
    """与 macro_series UNIQUE(source, code) 对齐（三轮 review 必须项 6）。"""

    source: str
    code: str
    region: str | None = None


@dataclass(frozen=True)
class MacroObservationDTO:
    observation_period: str
    release_at: datetime | None  # None → 无法确认发布时间
    value: float | None
    unit: str
    revision_hash: str
    raw: dict[str, Any] = field(default_factory=dict)
    data_gap: str | None = None


@dataclass(frozen=True)
class MacroSeriesSnapshot:
    ref: MacroSeriesRef
    observations: list[MacroObservationDTO]
    as_of: datetime
    data_gap: str | None = None


class MacroDataProvider(Protocol):
    async def series(self, ref: MacroSeriesRef, as_of: datetime) -> MacroSeriesSnapshot: ...


def _revision_hash(period: str, value: float | None, release: str | None) -> str:
    return hashlib.sha256(f"{period}|{value}|{release}".encode()).hexdigest()[:16]


def parse_observations(
    records: list[dict[str, Any]],
    period_key: str,
    value_key: str,
    unit: str,
    release_key: str | None = None,
) -> list[MacroObservationDTO]:
    """把 akshare 返回的记录列表解析为标准观测。

    release_key 为 None 或字段缺失 → release_at=None + data_gap（不用抓取时间冒充）。
    """
    out: list[MacroObservationDTO] = []
    for rec in records:
        period = str(rec.get(period_key, "")).strip()
        if not period:
            continue
        raw_value = rec.get(value_key)
        try:
            value: float | None = float(raw_value) if raw_value not in (None, "", "-") else None
        except (ValueError, TypeError):
            value = None

        release_at: datetime | None = None
        data_gap: str | None = None
        release_raw = rec.get(release_key) if release_key else None
        if release_raw:
            try:
                release_at = datetime.fromisoformat(str(release_raw)).replace(tzinfo=UTC)
            except ValueError:
                data_gap = "release_at 解析失败"
        else:
            data_gap = "无发布时间字段，进 data_gap（不用抓取时间冒充）"

        out.append(MacroObservationDTO(
            observation_period=period, release_at=release_at, value=value, unit=unit,
            revision_hash=_revision_hash(period, value, str(release_raw)),
            raw=dict(rec), data_gap=data_gap,
        ))
    return out


def filter_by_as_of(observations: list[MacroObservationDTO], as_of: datetime) -> list[MacroObservationDTO]:
    """时点口径：只保留 release_at<=as_of 的观测（§6.1）。

    release_at 为 None（发布时间未知）的观测保守剔除，避免未来数据泄漏。
    """
    return [o for o in observations if o.release_at is not None and o.release_at <= as_of]
