"""业务实体 Pydantic 出参（方案 §3.4）。只暴露前端所需，不泄露内部字段。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InstrumentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    asset_class: str
    exchange: str
    canonical_symbol: str
    display_code: str
    name: str
    market: str


class WatchlistItemView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    instrument_id: uuid.UUID
    code: str = ""  # instrument.display_code
    name: str = ""
    market: str = ""
    status: str
    thesis: str | None
    advice: str | None
    risk: str | None
    watch_signals: list[Any]
    analysis_status: str


class PositionView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    instrument_id: uuid.UUID
    code: str = ""  # instrument.display_code
    name: str = ""
    market: str = ""
    shares: float
    cost: float
    reason: str | None
    risk: str | None
    analysis_detail: dict[str, Any]
    analysis_status: str


class ReportView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    visibility: str
    title: str
    topic: str
    type: str
    type_label: str | None
    summary: str | None
    origin: str | None
    local_date: str | None
    tags: list[Any]
    highlights: list[Any]
    content_status: str
    created_at: datetime
    is_owner: bool = False
    # 个人态（合并自 user_report_states）
    starred: bool = False
    archived: bool = False
    read: bool = False


class SignalView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    date: str
    source: str
    theme: str | None
    industry: str | None
    summary: str | None
    signal_type: str | None
    importance: int
    state: str = "unread"  # 个人态（合并自 user_signal_states）


# ---- 写入请求（方案 §3.4）----


class WatchlistUpsertRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    market: str = Field(default="A股", max_length=32)
    status: str = Field(default="观察", max_length=16)
    thesis: str | None = None
    advice: str | None = None
    risk: str | None = None


class PositionUpsertRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    market: str = Field(default="A股", max_length=32)
    shares: float = Field(default=0, ge=0)
    cost: float = Field(default=0, ge=0)
    reason: str | None = None
    risk: str | None = None


class PositionUpdateRequest(BaseModel):
    shares: float = Field(ge=0)
    cost: float = Field(ge=0)


class SignalStateRequest(BaseModel):
    state: str = Field(pattern="^(unread|confirmed|ignored)$")


class OkResponse(BaseModel):
    ok: bool = True
