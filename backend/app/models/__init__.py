"""ORM 模型聚合导出。

导入本模块即注册所有表到 Base.metadata（供 Alembic autogenerate 与建表）。
"""

from app.models.base import Base
from app.models.debate import Debate
from app.models.instrument import Instrument
from app.models.macro import MacroObservation, MacroSeries
from app.models.market import (
    CommunitySignal,
    DailyBar,
    MarketIndex,
    QuoteOverride,
    UserSignalState,
)
from app.models.portfolio import Position, WatchlistItem
from app.models.report import Report, ReportAssetLink, UserReportState
from app.models.system import AutomationTask, Decision, Log, Setting
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
    "WatchlistItem",
    "Position",
    "Report",
    "UserReportState",
    "ReportAssetLink",
    "Debate",
    "MacroSeries",
    "MacroObservation",
    "CommunitySignal",
    "UserSignalState",
    "MarketIndex",
    "DailyBar",
    "QuoteOverride",
    "AutomationTask",
    "Decision",
    "Log",
    "Setting",
]
