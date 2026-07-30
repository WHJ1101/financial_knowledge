"""procrastinate 任务定义（方案 §7.5/§7.6）。

任务定义在一个 register(bp) 函数里，供 API app 与 worker app 各自用**独立** Blueprint 注册，
避免共享 Blueprint 被 add_tasks_from 重复命名空间前缀污染（fk:fk:...）。
连接器无关：API 用同步连接器 defer，worker 用异步连接器执行（§4.7）。
"""

from __future__ import annotations

from procrastinate import Blueprint


def run_debate(debate_id: str) -> None:
    """执行一次辩论（幂等：只更新该 debate，不重复建报告，方案 §7.5）。"""
    from app.services.debate_runner import execute_debate

    execute_debate(debate_id)


def analyze_watchlist(item_id: str) -> None:
    """自选智能分析（幂等：只更新该行，方案 §11.4）。"""
    from app.services.analyzer import analyze_watchlist_item

    analyze_watchlist_item(item_id)


def analyze_position_task(pos_id: str) -> None:
    """持仓智能分析（幂等：只更新该行，方案 §11.4）。"""
    from app.services.analyzer import analyze_position

    analyze_position(pos_id)


def run_daily_job(run_id: str) -> None:
    """按运行台账执行日更；业务终态由 run lifecycle 持久化。"""
    from app.services.automation import run_daily_automation

    run_daily_automation(run_id)


def run_automation_job(run_id: str) -> None:
    """按运行台账分派没有专用队列名的自动化任务。"""
    from app.services.automation import run_automation_task

    run_automation_task(run_id)


def refresh_research_source(
    run_id: str,
    capability_key: str,
    subject_key: str,
    parameters: dict[str, object],
) -> None:
    """按来源运行台账刷新单一能力，写原始快照与标准事实。"""
    from app.db import SessionLocal
    from app.services.research_data_hub.source_operations import execute_source_refresh

    with SessionLocal() as session:
        execute_source_refresh(
            session,
            run_id=run_id,
            capability_key=capability_key,
            subject_key=subject_key,
            parameters=parameters,
        )


def sync_feishu_signal_source(run_id: str, execution_owner_id: str) -> None:
    """执行飞书 section 增量/回补同步。"""
    import asyncio

    from app.db import SessionLocal
    from app.services.signal_ingestion import execute_signal_sync_run

    with SessionLocal() as session:
        asyncio.run(
            execute_signal_sync_run(
                session,
                run_id=run_id,
                execution_owner_id=execution_owner_id,
            )
        )


def tick_scheduler(timestamp: int) -> None:
    """读 automation_tasks 到点且当天未跑的任务，defer 业务任务（§7.6）。先占位防重复。"""
    from app.services.scheduler_service import tick

    tick()


def tick_research_sources(timestamp: int) -> None:
    """按 freshness 清单补齐到期的宏观能力。"""
    from app.services.research_data_hub.scheduler import tick_research_data

    tick_research_data()


def make_blueprint() -> Blueprint:
    """每次返回全新 Blueprint（不共享，避免命名空间重复前缀）。"""
    bp = Blueprint()
    bp.task(name="run_debate", queue="debates", retry=3)(run_debate)
    bp.task(name="analyze_watchlist", queue="analysis", retry=2)(analyze_watchlist)
    bp.task(name="analyze_position", queue="analysis", retry=2)(analyze_position_task)
    bp.task(name="run_daily", queue="scheduler")(run_daily_job)
    bp.task(name="run_automation", queue="scheduler")(run_automation_job)
    bp.task(name="refresh_research_source", queue="research")(refresh_research_source)
    bp.task(name="sync_feishu_signal_source", queue="signals")(sync_feishu_signal_source)
    bp.periodic(cron="* * * * *")(bp.task(name="tick_scheduler", queue="scheduler")(tick_scheduler))
    bp.periodic(cron="17 * * * *")(
        bp.task(name="tick_research_sources", queue="scheduler")(tick_research_sources)
    )
    return bp
