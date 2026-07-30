"""从迁移前 schema 升级到当前 head，验证密文、归属和索引均保留。"""

from __future__ import annotations

import hashlib
import json
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


def test_upgrade_preserves_byok_and_repairs_legacy_ownership(tmp_path: Path) -> None:
    base_url = os.environ["FINANCE_KNOWLEDGE_DATABASE_URL"]
    parsed = urlsplit(base_url)
    database = f"fk_alembic_{uuid.uuid4().hex[:10]}_test"
    target_url = urlunsplit(parsed._replace(path=f"/{database}"))
    maintenance = psycopg2.connect(_dsn(base_url, "postgres"))
    maintenance.autocommit = True
    try:
        with maintenance.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        env = {
            **os.environ,
            "FINANCE_KNOWLEDGE_DATABASE_URL": target_url,
            "FINANCE_KNOWLEDGE_DATA_DIR": str(tmp_path),
        }
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "df4995eb3fdf"],
            cwd=BACKEND_ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

        admin_id = uuid.uuid4()
        instrument_id = uuid.uuid4()
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
                cursor.execute(
                    "INSERT INTO instruments "
                    "(id,asset_class,exchange,canonical_symbol,display_code,name,market,"
                    "provider_ids,active) "
                    "VALUES (%s,'etf','SSE','588080','588080','科创板100ETF','ETF',"
                    """'{"eastmoney":"1.588080"}',true)""",
                    (str(instrument_id),),
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
                cursor.execute("SELECT to_regclass('public.decisions')")
                assert cursor.fetchone() == (None,)
                cursor.execute(
                    "SELECT must_change_password,password_changed_at FROM users WHERE id=%s",
                    (str(admin_id),),
                )
                assert cursor.fetchone() == (False, None)
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
                cursor.execute(
                    "SELECT to_regclass('public.automation_runs'), "
                    "to_regclass('public.source_sync_runs'), "
                    "to_regclass('public.instrument_provider_refs')"
                )
                assert cursor.fetchone() == (
                    "automation_runs",
                    "source_sync_runs",
                    "instrument_provider_refs",
                )
                cursor.execute(
                    "SELECT provider,provider_key,upstream_family "
                    "FROM instrument_provider_refs WHERE instrument_id=%s",
                    (str(instrument_id),),
                )
                assert cursor.fetchone() == ("eastmoney", "1.588080", "eastmoney")
                cursor.execute(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name='instruments' AND column_name='provider_ids'"
                )
                assert cursor.fetchone() is None
                cursor.execute(
                    "SELECT indexname FROM pg_indexes WHERE schemaname='public' "
                    "AND indexname IN "
                    "('uq_automation_runs_active_kind','uq_source_sync_runs_active_key')"
                )
                assert {row[0] for row in cursor.fetchall()} == {
                    "uq_automation_runs_active_kind",
                    "uq_source_sync_runs_active_key",
                }
        finally:
            connection.close()
        archive = tmp_path / "archives" / f"legacy-decisions-i1a5e6f7b8c9-{database}.json"
        payload = json.loads(archive.read_text(encoding="utf-8"))
        canonical = json.dumps(
            payload["decisions"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        assert payload["row_count"] == 1
        assert payload["decisions"][0]["id"] == "legacy-decision"
        assert payload["sha256"] == hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "c4a8e2d6f9b1"],
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
                    "SELECT to_regclass('public.automation_runs'), "
                    "to_regclass('public.source_sync_runs'), "
                    "to_regclass('public.instrument_provider_refs')"
                )
                assert cursor.fetchone() == (None, None, None)
                cursor.execute(
                    "SELECT provider_ids->>'eastmoney' FROM instruments WHERE id=%s",
                    (str(instrument_id),),
                )
                assert cursor.fetchone() == ("1.588080",)
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
    finally:
        with maintenance.cursor() as cursor:
            cursor.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s",
                (database,),
            )
            cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))
        maintenance.close()
