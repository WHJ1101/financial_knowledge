"""从迁移前 schema 升级到当前 head，验证密文、归属和索引均保留。"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg2
from psycopg2 import sql

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _dsn(url: str, database: str | None = None) -> str:
    parsed = urlsplit(url.replace("+psycopg2", ""))
    if database is not None:
        parsed = parsed._replace(path=f"/{database}")
    return urlunsplit(parsed)


def test_upgrade_preserves_byok_and_repairs_legacy_ownership() -> None:
    base_url = os.environ["FINANCE_KNOWLEDGE_DATABASE_URL"]
    parsed = urlsplit(base_url)
    database = f"fk_alembic_{uuid.uuid4().hex[:10]}_test"
    target_url = urlunsplit(parsed._replace(path=f"/{database}"))
    maintenance = psycopg2.connect(_dsn(base_url, "postgres"))
    maintenance.autocommit = True
    try:
        with maintenance.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        env = {**os.environ, "FINANCE_KNOWLEDGE_DATABASE_URL": target_url}
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "df4995eb3fdf"],
            cwd=BACKEND_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

        admin_id = uuid.uuid4()
        connection = psycopg2.connect(_dsn(target_url))
        try:
            with connection, connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO users (id,username,password_hash,role,status) "
                    "VALUES (%s,'admin','hash','superadmin','active')",
                    (str(admin_id),),
                )
                cursor.execute(
                    "INSERT INTO user_llm_configs "
                    "(user_id,api_key_ciphertext,api_url,model,key_version) "
                    "VALUES (%s,'encrypted-key','https://openrouter.ai/api/v1','model-before',7)",
                    (str(admin_id),),
                )
                cursor.execute(
                    "INSERT INTO reports "
                    "(id,owner_id,visibility,title,topic,type,tags,highlights,meta,content_status) "
                    "VALUES ('legacy-report',%s,'private','旧报告','主题','custom','[]','[]','{}','ok')",
                    (str(admin_id),),
                )
                cursor.execute(
                    "INSERT INTO decisions "
                    "(id,title,position_advice,stock_advice,reports) "
                    "VALUES ('legacy-decision','旧决策','[]','[]','[]')"
                )
        finally:
            connection.close()

        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        # 重复执行必须安全。
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

        connection = psycopg2.connect(_dsn(target_url))
        try:
            with connection, connection.cursor() as cursor:
                cursor.execute(
                    "SELECT name,api_key_ciphertext,model,key_version,enabled,is_default "
                    "FROM llm_profiles WHERE user_id=%s",
                    (str(admin_id),),
                )
                assert cursor.fetchone() == (
                    "默认模型",
                    "encrypted-key",
                    "model-before",
                    7,
                    True,
                    True,
                )
                cursor.execute("SELECT owner_id,visibility FROM reports WHERE id='legacy-report'")
                owner_id, visibility = cursor.fetchone()
                assert (str(owner_id), visibility) == (str(admin_id), "shared")
                cursor.execute("SELECT owner_id,visibility FROM decisions WHERE id='legacy-decision'")
                owner_id, visibility = cursor.fetchone()
                assert (str(owner_id), visibility) == (str(admin_id), "private")
                cursor.execute(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name='debates' AND column_name='queue_job_id'"
                )
                assert cursor.fetchone() == ("bigint",)
                cursor.execute(
                    "SELECT indexname FROM pg_indexes WHERE schemaname='public' "
                    "AND indexname IN "
                    "('uq_llm_profiles_one_default_per_user','uq_debates_owner_instrument_active')"
                )
                assert {row[0] for row in cursor.fetchall()} == {
                    "uq_llm_profiles_one_default_per_user",
                    "uq_debates_owner_instrument_active",
                }
        finally:
            connection.close()
    finally:
        with maintenance.cursor() as cursor:
            cursor.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s",
                (database,),
            )
            cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))
        maintenance.close()
