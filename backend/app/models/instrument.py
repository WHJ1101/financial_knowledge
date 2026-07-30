"""统一证券身份 instruments（方案 §4.1，Review R2 + 三轮 review 必须项 3）。

规范化唯一键 (exchange, asset_class, canonical_symbol)，不用 (market, code)：
实测存量混用 SZ301308/301308/159995/OF.014662/1.588080，且同号码可能一个是 ETF、
一个是场外基金。market 降为纯展示字段，各源标识由 instrument_provider_refs 管理。
"""

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk


class Instrument(Base, TimestampMixin):
    __tablename__ = "instruments"
    __table_args__ = (UniqueConstraint("exchange", "asset_class", "canonical_symbol", name="uq_instrument_identity"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    asset_class: Mapped[str] = mapped_column(String(24))  # equity/etf/open_end_fund/hk_stock/us_stock
    exchange: Mapped[str] = mapped_column(String(16))  # SSE/SZSE/HKEX/NASDAQ/NYSE/OTC_FUND
    canonical_symbol: Mapped[str] = mapped_column(String(32), index=True)  # 剥前缀纯代码：301308/159995/014662
    display_code: Mapped[str] = mapped_column(String(32))  # 展示原样：SZ301308/OF.014662
    name: Mapped[str] = mapped_column(String(128))
    market: Mapped[str] = mapped_column(String(32))  # 仅展示标签（创业板/基金/ETF/美股…），不参与唯一
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    provider_refs: Mapped[list["InstrumentProviderRef"]] = relationship(
        back_populates="instrument",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class InstrumentProviderRef(Base, TimestampMixin):
    """Instrument 在具体 Provider 中的稳定身份。"""

    __tablename__ = "instrument_provider_refs"
    __table_args__ = (
        UniqueConstraint("provider", "provider_key", name="uq_instrument_provider_ref_identity"),
        UniqueConstraint(
            "instrument_id",
            "provider",
            "provider_key",
            name="uq_instrument_provider_ref_membership",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    instrument_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32))
    provider_key: Mapped[str] = mapped_column(String(128))
    upstream_family: Mapped[str] = mapped_column(String(32))
    ref_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    instrument: Mapped[Instrument] = relationship(back_populates="provider_refs")
