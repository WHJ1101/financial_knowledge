"""ORM 模型聚合导出。

导入本模块即注册所有表到 Base.metadata（供 Alembic autogenerate 与建表）。
"""

from app.models.base import Base
from app.models.debate import Debate
from app.models.instrument import Instrument, InstrumentProviderRef
from app.models.macro import MacroObservation, MacroSeries
from app.models.market import DailyBar, MarketIndex, QuoteOverride
from app.models.portfolio import Position, WatchlistItem
from app.models.report import Report, ReportAssetLink, UserReportState
from app.models.research_data import (
    FundHolding,
    FundHoldingSnapshot,
    FundNavObservation,
    FundProfileSnapshot,
    IndexConstituent,
    IndexConstituentSnapshot,
    InstrumentEvent,
    InstrumentMetricObservation,
    InstrumentMetricSeries,
    MacroReleaseEvent,
    SourcePayloadSnapshot,
)
from app.models.signal import CommunitySignal, NotificationDelivery, SignalSourceSection, UserSignalState
from app.models.system import AutomationRun, AutomationTask, Log, Setting, SourceSyncRun
from app.models.user import InviteCode, LlmAgentRoute, LlmProfile, RateLimitBucket, User, UserSession

__all__ = [
    "Base",
    "User",
    "UserSession",
    "InviteCode",
    "LlmProfile",
    "LlmAgentRoute",
    "RateLimitBucket",
    "Instrument",
    "InstrumentProviderRef",
    "WatchlistItem",
    "Position",
    "Report",
    "UserReportState",
    "ReportAssetLink",
    "Debate",
    "MacroSeries",
    "MacroObservation",
    "SourcePayloadSnapshot",
    "MacroReleaseEvent",
    "IndexConstituentSnapshot",
    "IndexConstituent",
    "InstrumentMetricSeries",
    "InstrumentMetricObservation",
    "InstrumentEvent",
    "FundNavObservation",
    "FundHoldingSnapshot",
    "FundHolding",
    "FundProfileSnapshot",
    "CommunitySignal",
    "SignalSourceSection",
    "UserSignalState",
    "NotificationDelivery",
    "MarketIndex",
    "DailyBar",
    "QuoteOverride",
    "AutomationTask",
    "AutomationRun",
    "SourceSyncRun",
    "Log",
    "Setting",
]
