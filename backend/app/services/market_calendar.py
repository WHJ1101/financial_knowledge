"""交易所日历状态；同时处理周末、法定休市和交易所临时休市日。"""

from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache
from typing import Any


@lru_cache(maxsize=3)
def _calendar(name: str) -> Any:
    import exchange_calendars as xcals

    return xcals.get_calendar(name)


def market_sessions(now: datetime | None = None) -> list[dict[str, Any]]:
    import pandas as pd

    instant = now or datetime.now(UTC)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    minute = pd.Timestamp(instant).floor("min")
    definitions = (("A", "A股", "XSHG"), ("HK", "港股", "XHKG"), ("US", "美股", "XNYS"))
    result: list[dict[str, Any]] = []
    for key, label, calendar_name in definitions:
        calendar = _calendar(calendar_name)
        result.append(
            {
                "key": key,
                "label": label,
                "open": bool(calendar.is_open_on_minute(minute, ignore_breaks=False)),
                "calendar": calendar_name,
            }
        )
    return result
