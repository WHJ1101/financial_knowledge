"""SQLAlchemy 2.0 引擎与会话（方案 §3.1：同步 Session + psycopg2）。

psycopg2 驱动是 M0 定案（§4.7）：procrastinate 的 SQLAlchemyPsycopg2Connector
要求同一 SQLAlchemy 事务内 defer，故全栈用 psycopg2 而非 psycopg3。
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# pool_pre_ping：长连接失效自动重连；echo 仅开发期可开
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_session() -> Iterator[Session]:
    """FastAPI 依赖：每请求一个 Session，结束回收。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
