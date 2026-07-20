"""procrastinate App 装配（方案 §4.7/§4.8）。

两个连接器分用途，共享同一 Blueprint（app.tasks.tasks）：
- procrastinate_app（同步 SQLAlchemyPsycopg2Connector）：API 侧同事务 defer（§4.7）。
- build_worker_app()（异步 PsycopgConnector/psycopg3）：worker run_worker 用。
任务定义在 Blueprint 上（连接器无关），两个 app 各自 add_tasks_from 挂载。
"""

from procrastinate import App, PsycopgConnector
from procrastinate.contrib.sqlalchemy import SQLAlchemyPsycopg2Connector
from procrastinate.schema import SchemaManager
from psycopg import AsyncConnection

from app.config import get_settings
from app.tasks import make_blueprint

# API 侧：同步连接器，支持 configure(connection=...).defer() 同事务入队
procrastinate_app = App(connector=SQLAlchemyPsycopg2Connector(dsn=get_settings().database_url))
procrastinate_app.add_tasks_from(make_blueprint(), namespace="fk")


def _async_dsn() -> str:
    """SQLAlchemy DSN(postgresql+psycopg2://) → psycopg3 可用的 postgresql://。"""
    return get_settings().database_url.replace("+psycopg2", "")


def build_worker_app() -> App:
    """worker 侧：异步连接器 + 独立 Blueprint（同一 namespace，任务名与 API 侧一致）。"""
    app = App(connector=PsycopgConnector(conninfo=_async_dsn()))
    app.add_tasks_from(make_blueprint(), namespace="fk")
    return app


async def ensure_queue_schema() -> bool:
    """在 advisory lock 内幂等创建队列表；返回本次是否执行了建表。

    ``SchemaManager.apply_schema`` 只支持空数据库，而且 SQLAlchemy 连接器会与
    SchemaManager 重复转义 schema 中的 ``%``。这里使用 psycopg3 原生连接执行
    官方 schema，并用事务级 advisory lock 避免 API/worker 容器并发首次启动。
    """
    connection = await AsyncConnection.connect(_async_dsn())
    async with connection, connection.transaction():
        await connection.execute("SELECT pg_advisory_xact_lock(hashtext('financial_knowledge_queue_schema'))")
        cursor = await connection.execute("SELECT to_regclass('public.procrastinate_jobs') AS table_name")
        row = await cursor.fetchone()
        if row is not None and row[0] is not None:
            return False
        # 不传参数时 psycopg3 直接执行原始 SQL；额外转义会让 PL/pgSQL 的
        # RAISE 占位符从 ``%`` 变成字面量 ``%%``。
        await connection.execute(SchemaManager.get_schema())
        return True


def cancel_job(job_id: int, *, abort_running: bool = True) -> bool:
    """用短连接取消 todo 任务或请求 running 任务中止；业务层仍用 cancel_requested_at 协作停止。"""
    app = App(connector=SQLAlchemyPsycopg2Connector(dsn=get_settings().database_url))
    app.add_tasks_from(make_blueprint(), namespace="fk")
    try:
        app.open()
        return app.job_manager.cancel_job_by_id(job_id, abort=abort_running)
    finally:
        app.close()
