"""全局测试隔离：独立 PostgreSQL 数据库 + 独立临时 data_dir。

该文件在测试模块导入前设置环境，防止任何测试连接开发/生产库或写入真实报告目录。
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg2
import pytest
from psycopg2 import sql


def _test_url() -> tuple[str, str, str]:
    base = os.environ.get(
        "FINANCE_KNOWLEDGE_DATABASE_URL",
        "postgresql+psycopg2://fk:fk@localhost:5432/financial_knowledge",
    )
    explicit = os.environ.get("FINANCE_KNOWLEDGE_TEST_DATABASE_URL")
    parsed = urlsplit(base)
    base_db = parsed.path.lstrip("/")
    test_db = f"{base_db}_test"
    derived = urlunsplit(parsed._replace(path=f"/{test_db}"))
    target = explicit or derived
    if target == base or not urlsplit(target).path.rstrip("/").endswith("_test"):
        raise RuntimeError("测试数据库必须与业务库不同，且数据库名必须以 _test 结尾")
    return base, target, urlsplit(target).path.lstrip("/")


_BASE_URL, _TEST_URL, _TEST_DB_NAME = _test_url()
_DATA_DIR = Path(tempfile.mkdtemp(prefix="financial-knowledge-tests-"))
os.environ["FINANCE_KNOWLEDGE_DATABASE_URL"] = _TEST_URL
os.environ["FINANCE_KNOWLEDGE_DATA_DIR"] = str(_DATA_DIR)
os.environ["FINANCE_KNOWLEDGE_ENVIRONMENT"] = "test"


def _psycopg_dsn(url: str, database: str | None = None) -> str:
    parsed = urlsplit(url.replace("+psycopg2", ""))
    if database is not None:
        parsed = parsed._replace(path=f"/{database}")
    return urlunsplit(parsed)


def _ensure_test_database() -> None:
    parsed = urlsplit(_BASE_URL)
    maintenance = "postgres" if parsed.path.lstrip("/") != "postgres" else "template1"
    conn = psycopg2.connect(_psycopg_dsn(_BASE_URL, maintenance))
    conn.autocommit = True
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname=%s", (_TEST_DB_NAME,))
            if cursor.fetchone() is None:
                cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(_TEST_DB_NAME)))
    finally:
        conn.close()


def pytest_sessionstart(session: pytest.Session) -> None:
    try:
        _ensure_test_database()
        from sqlalchemy import text

        from app.db import engine
        from app.models import Base
        from app.queue import ensure_queue_schema

        # DB-F removed the legacy decisions ORM/table. Clear a stale pre-DB-F
        # test database before metadata-driven teardown no longer knows it.
        with engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS decisions CASCADE"))
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        asyncio.run(ensure_queue_schema())
        with engine.begin() as connection:
            connection.execute(
                text(
                    "TRUNCATE TABLE procrastinate_periodic_defers, procrastinate_events, "
                    "procrastinate_jobs, procrastinate_workers RESTART IDENTITY CASCADE"
                )
            )
    except Exception as exc:  # noqa: BLE001
        pytest.exit(f"测试隔离数据库初始化失败：{exc}", returncode=2)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    try:
        from app.db import engine

        engine.dispose()
    finally:
        shutil.rmtree(_DATA_DIR, ignore_errors=True)
