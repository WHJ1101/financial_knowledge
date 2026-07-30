"""独立 worker 入口（方案 §2.1/§7.5/§7.6）。

procrastinate worker：领取 debates/analysis/scheduler/research 队列任务 + 持有周期调度。
连接器分工见 app.queue：API 侧同步 defer，worker 侧异步 run_worker。

运行：uv run python -m app.worker
"""

from __future__ import annotations

from app.config import get_settings, validate_runtime_settings
from app.queue import build_worker_app

validate_runtime_settings(get_settings())
worker_app = build_worker_app()


def main() -> None:
    # run_worker 内部自建事件循环 + async with open_async()（异步连接器）
    worker_app.run_worker(
        queues=["debates", "analysis", "scheduler", "research", "signals"],
        install_signal_handlers=True,
    )


if __name__ == "__main__":
    main()
