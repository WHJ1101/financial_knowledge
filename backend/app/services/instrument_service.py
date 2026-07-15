"""证券解析服务：按 code+market 找到或创建 instrument（方案 §4.1）。

用于持仓/自选写入时把前端传的 code/market 归一到统一证券身份。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Instrument
from app.services.instrument_identity import normalize


def resolve_or_create_instrument(session: Session, code: str, market: str | None, name: str = "") -> Instrument:
    """按 (exchange, asset_class, canonical_symbol) 查已有，否则新建。无法规范化→400。"""
    norm = normalize(code, market)
    if norm is None:
        raise HTTPException(status_code=400, detail=f"无法识别证券代码: {code} ({market})")
    existing = session.execute(
        select(Instrument).where(
            Instrument.exchange == norm.exchange,
            Instrument.asset_class == norm.asset_class,
            Instrument.canonical_symbol == norm.canonical_symbol,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    now = datetime.now(UTC)
    inst = Instrument(
        id=uuid.uuid4(), asset_class=norm.asset_class, exchange=norm.exchange,
        canonical_symbol=norm.canonical_symbol, display_code=norm.display_code,
        name=name or norm.display_code, market=(market or ""), provider_ids={},
        source="user", active=True, created_at=now, updated_at=now,
    )
    session.add(inst)
    session.flush()
    return inst
