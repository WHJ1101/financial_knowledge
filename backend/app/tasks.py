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


def run_daily_briefing_job(task_id: str) -> None:
    """日更简报任务（scheduler dispatcher 触发，超管 owner，方案 §11.6）。"""
    from app.services.automation import run_daily_briefing_task

    run_daily_briefing_task(task_id)


def run_automation_job(task_id: str) -> None:
    """执行没有专用 worker 的任务；当前会落一条明确的跳过日志。"""
    from app.services.automation import run_automation_task

    run_automation_task(task_id)


def tick_scheduler(timestamp: int) -> None:
    """读 automation_tasks 到点且当天未跑的任务，defer 业务任务（§7.6）。先占位防重复。"""
    from app.services.scheduler_service import tick

    tick()


def make_blueprint() -> Blueprint:
    """每次返回全新 Blueprint（不共享，避免命名空间重复前缀）。"""
    bp = Blueprint()
    bp.task(name="run_debate", queue="debates", retry=3)(run_debate)
    bp.task(name="analyze_watchlist", queue="analysis", retry=2)(analyze_watchlist)
    bp.task(name="analyze_position", queue="analysis", retry=2)(analyze_position_task)
    bp.task(name="run_daily_briefing", queue="scheduler", retry=2)(run_daily_briefing_job)
    bp.task(name="run_automation", queue="scheduler")(run_automation_job)
    bp.periodic(cron="* * * * *")(bp.task(name="tick_scheduler", queue="scheduler")(tick_scheduler))
    return bp
