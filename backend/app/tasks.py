"""procrastinate 任务定义（方案 §7.5/§7.6）。

- run_debate：辩论任务（M8 接 LangGraph 图；M7 先占位可入队/领取）。
- tick_scheduler：每分钟周期任务，读 automation_tasks 动态调度（§7.6 dispatcher）。
worker 持有周期调度；API 只创建任务、不跑调度器（§2.1）。
"""

from __future__ import annotations

from app.queue import procrastinate_app


@procrastinate_app.task(name="run_debate", queue="debates")
def run_debate(debate_id: str) -> None:
    """执行一次辩论（幂等：只更新该 debate，不重复建报告，方案 §7.5）。

    M8 接入 LangGraph 图。M7 阶段：占位实现，验证入队/领取链路。
    """
    from app.services.debate_runner import execute_debate

    execute_debate(debate_id)


@procrastinate_app.periodic(cron="* * * * *")  # 每分钟（§7.6 tick dispatcher）
@procrastinate_app.task(name="tick_scheduler", queue="scheduler")
def tick_scheduler(timestamp: int) -> None:
    """读 automation_tasks 中到点且当天未跑的任务，defer 实际业务任务（§7.6）。

    DB 改 schedule 下一分钟生效；先占位再执行防重复（对齐 scheduler.js 语义）。
    M8 接入具体业务任务（日报生成）。
    """
    from app.services.scheduler_service import tick

    tick()
