"""独立 worker 入口（方案 §2.1/§7.5/§7.6）。

procrastinate worker：领取 debates/scheduler 队列任务 + 持有周期调度。
与 app.main 共享同一 Python 包，仅入口不同。

运行：uv run python -m app.worker
"""

from __future__ import annotations

import app.tasks  # noqa: F401 —— 注册 run_debate / tick_scheduler 到 procrastinate_app
from app.queue import procrastinate_app


def main() -> None:
    with procrastinate_app.open():
        procrastinate_app.run_worker(queues=["debates", "scheduler"], wait=True)


if __name__ == "__main__":
    main()
