"""数据源 Provider 接口与领域类型（方案 §6.1）。

领域层只依赖这些 Protocol 与快照类型，不感知具体网站/SDK。
每个返回对象携带来源元数据：source/source_url/retrieved_at/data_gap。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class InstrumentRef:
    """Provider 取数所需的证券引用（来自 instruments）。"""

    canonical_symbol: str
    exchange: str
    asset_class: str
    provider_ids: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Bar:
    date: str
    close: float | None
    volume: float | None


@dataclass(frozen=True)
class QuoteSnapshot:
    name: str
    price: float | None
    change_pct: str | None
    source: str
    source_url: str
    retrieved_at: datetime
    data_gap: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FundamentalSnapshot:
    """估值快照（辩论文档附录 A：PE/PB/ROE/营收净利同比/市值）。"""

    pe: float | None = None
    pb: float | None = None
    roe: float | None = None
    revenue_yoy: float | None = None
    profit_yoy: float | None = None
    market_cap: float | None = None
    source: str = "eastmoney"
    source_url: str = ""
    retrieved_at: datetime | None = None
    data_gap: str | None = None


class MarketDataProvider(Protocol):
    async def quote(self, ref: InstrumentRef) -> QuoteSnapshot: ...
    async def bars(self, ref: InstrumentRef, limit: int = 250) -> list[Bar]: ...


class FundamentalDataProvider(Protocol):
    async def snapshot(self, ref: InstrumentRef) -> FundamentalSnapshot: ...
