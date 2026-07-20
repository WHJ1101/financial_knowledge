#!/bin/sh
# 容器入口。Schema 与超管初始化只允许 init-db 一次性服务执行，
# API/Worker 等待 init-db 成功后直接启动，避免多容器并发迁移。
set -e

if [ "${FINANCE_KNOWLEDGE_RUN_INIT:-false}" = "true" ]; then
  echo "[entrypoint] alembic upgrade head（业务表）"
  alembic upgrade head

  echo "[entrypoint] procrastinate schema（队列表，独立于业务 Alembic）"
  python -c "
import asyncio
from app.queue import ensure_queue_schema

created = asyncio.run(ensure_queue_schema())
print('[entrypoint] procrastinate schema created' if created else '[entrypoint] procrastinate schema already present')
"

  echo "[entrypoint] 初始化超管（幂等）"
  python -m app.bootstrap
fi

echo "[entrypoint] exec: $*"
exec "$@"
