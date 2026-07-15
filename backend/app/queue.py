"""procrastinate App 装配（方案 §4.7/§4.8）。

- 运行时同事务入队：用 SQLAlchemyPsycopg2Connector（psycopg2），业务写与 defer 同一 SQLAlchemy 事务。
- schema 初始化：一次性管理操作，用 CLI（`procrastinate -a app.queue.procrastinate_app schema --apply`），
  走 psycopg3 连接器执行多语句 DDL；不纳入业务 Alembic（§4.8）。
"""

from procrastinate import App
from procrastinate.contrib.sqlalchemy import SQLAlchemyPsycopg2Connector

from app.config import get_settings

procrastinate_app = App(
    connector=SQLAlchemyPsycopg2Connector(dsn=get_settings().database_url),
)
