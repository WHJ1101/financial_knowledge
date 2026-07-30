"""FastAPI 应用入口。

职责（方案 §2.1/§10.1）：只提供 /api/v1/* 和鉴权后的报告内容接口。
- 不 serve 前端静态（Caddy 独占）
- 不跑辩论调度器（worker 持有 procrastinate 周期任务）
- 行情快照轮询：进程内轻量后台任务（lifespan 启停，空缓存重试、任一市场开盘刷新，§11.1）
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api import admin_users as admin_users_api
from app.api import auth as auth_api
from app.api import decisions as decisions_api
from app.api import exports as exports_api
from app.api import instruments as instruments_api
from app.api import integrations as integrations_api
from app.api import jobs as jobs_api
from app.api import market as market_api
from app.api import portfolio as portfolio_api
from app.api import pressure as pressure_api
from app.api import report_actions as report_actions_api
from app.api import report_assets as report_assets_api
from app.api import reports as reports_api
from app.api import research_data as research_data_api
from app.api import settings as settings_api
from app.api import signals as signals_api
from app.api import status as status_api
from app.api import tasks as tasks_api
from app.config import get_settings, validate_runtime_settings
from app.db import SessionLocal
from app.services.market import refresh_market_cache, should_refresh_market_cache

settings = get_settings()
validate_runtime_settings(settings)
logger = logging.getLogger(__name__)

_MARKET_POLL_INTERVAL = 30  # 秒，对齐旧 startMarketPoller


async def _market_poller() -> None:
    """启动即抓一次，之后每 30s 按缓存状态和全球市场时段刷新指数快照。"""
    try:
        await refresh_market_cache()
    except Exception:  # noqa: BLE001 -- 行情提供方故障不应终止 API lifespan
        logger.exception("启动行情快照刷新失败，轮询器将在下个周期重试")
    while True:
        await asyncio.sleep(_MARKET_POLL_INTERVAL)
        if should_refresh_market_cache():
            try:
                await refresh_market_cache()
            except Exception:  # noqa: BLE001 -- 保持后台循环存活
                logger.exception("行情快照刷新失败，轮询器将在下个周期重试")


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_market_poller())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="投研工作台 API",
    version="1.0.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.include_router(auth_api.router)
app.include_router(admin_users_api.router)
app.include_router(portfolio_api.router)
app.include_router(reports_api.router)
app.include_router(report_actions_api.router)
app.include_router(report_assets_api.router)
app.include_router(pressure_api.router)
app.include_router(settings_api.router)
app.include_router(decisions_api.router)
app.include_router(signals_api.router)
app.include_router(market_api.router)
app.include_router(instruments_api.router)
app.include_router(integrations_api.router)
app.include_router(jobs_api.router)
app.include_router(tasks_api.router)
app.include_router(research_data_api.router)
app.include_router(exports_api.router)
app.include_router(status_api.router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    """健康检查：同时验证 API 进程与 PostgreSQL 连接。"""
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.error("健康检查数据库不可用：%s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="database_unavailable") from exc
    return {"status": "ok", "environment": settings.environment}
