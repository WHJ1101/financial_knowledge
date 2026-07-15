"""FastAPI 应用入口。

职责（方案 §2.1/§10.1）：只提供 /api/v1/* 和鉴权后的报告内容接口。
- 不 serve 前端静态（Caddy 独占）
- 不跑调度器（worker 持有 procrastinate 周期任务）
"""

from fastapi import FastAPI

from app.api import auth as auth_api
from app.api import decisions as decisions_api
from app.api import portfolio as portfolio_api
from app.api import pressure as pressure_api
from app.api import report_actions as report_actions_api
from app.api import reports as reports_api
from app.api import settings as settings_api
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="投研工作台 API",
    version="1.0.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

app.include_router(auth_api.router)
app.include_router(portfolio_api.router)
app.include_router(reports_api.router)
app.include_router(report_actions_api.router)
app.include_router(pressure_api.router)
app.include_router(settings_api.router)
app.include_router(decisions_api.router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    """健康检查：供 Compose healthcheck 与部署验收使用。"""
    return {"status": "ok", "environment": settings.environment}
