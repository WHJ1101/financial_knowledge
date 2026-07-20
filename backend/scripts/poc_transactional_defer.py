"""§4.7 P0 PoC：验证 SQLAlchemyPsycopg2Connector 同事务 defer 的原子性。

不变式（方案 §4.7）：业务写与 procrastinate 入队在同一 SQLAlchemy 事务里，
要么一起提交、要么一起回滚。用一张临时业务表 + 两个场景验证：
  场景 A：commit → 业务行在 + job 在队列
  场景 B：rollback → 业务行不在 + job 也不在（原子回滚，无"业务已建但任务丢失/多余"）
"""

import sys

from procrastinate import App
from procrastinate.contrib.sqlalchemy import SQLAlchemyPsycopg2Connector
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import get_settings

settings = get_settings()

# procrastinate schema 已通过 psql 预先灌入（方案 §4.8：队列表不纳入业务 Alembic）
connector = SQLAlchemyPsycopg2Connector(dsn=settings.database_url)
procrastinate_app = App(connector=connector)


@procrastinate_app.task(name="poc_noop")
def poc_noop(debate_id: str) -> None:  # 真实任务在 M8 落地；此处仅验证入队
    pass


def count_jobs(conn: Connection) -> int:
    return int(conn.execute(text("SELECT count(*) FROM procrastinate_jobs WHERE task_name='poc_noop'")).scalar_one())


def main() -> int:
    with procrastinate_app.open():
        engine = connector.engine  # 复用 procrastinate 的 SQLAlchemy engine，保证同一事务边界
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE IF NOT EXISTS _poc_debates (id text primary key)"))
            conn.execute(text("DELETE FROM _poc_debates"))
            conn.execute(text("DELETE FROM procrastinate_jobs WHERE task_name='poc_noop'"))

        # 场景 B：同事务内写业务行 + defer，然后 rollback —— 两者都应消失
        base_jobs = None
        with engine.connect() as conn:
            base_jobs = count_jobs(conn)
        try:
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO _poc_debates (id) VALUES ('rollback-1')"))
                # SQLAlchemyPsycopg2Connector 要 SQLAlchemy Connection（用 exec_driver_sql）
                poc_noop.configure(connection=conn).defer(debate_id="rollback-1")
                raise RuntimeError("故意回滚")
        except RuntimeError:
            pass
        with engine.connect() as conn:
            rows_b = conn.execute(text("SELECT count(*) FROM _poc_debates WHERE id='rollback-1'")).scalar_one()
            jobs_b = count_jobs(conn)
        assert rows_b == 0, f"回滚后业务行应为 0，实际 {rows_b}"
        assert jobs_b == base_jobs, f"回滚后 job 数应不变（{base_jobs}），实际 {jobs_b}"
        print(f"[场景 B rollback] 业务行=0 ✓  job 数未增（{jobs_b}）✓  —— 原子回滚成立")

        # 场景 A：同事务内写业务行 + defer，commit —— 两者都应存在
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO _poc_debates (id) VALUES ('commit-1')"))
            poc_noop.configure(connection=conn).defer(debate_id="commit-1")
        with engine.connect() as conn:
            rows_a = conn.execute(text("SELECT count(*) FROM _poc_debates WHERE id='commit-1'")).scalar_one()
            jobs_a = count_jobs(conn)
        assert rows_a == 1, f"提交后业务行应为 1，实际 {rows_a}"
        assert jobs_a == base_jobs + 1, f"提交后 job 应 +1（{base_jobs + 1}），实际 {jobs_a}"
        print(f"[场景 A commit]   业务行=1 ✓  job 数 +1（{jobs_a}）✓  —— 同事务原子入队成立")

        # 清理
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE _poc_debates"))
            conn.execute(text("DELETE FROM procrastinate_jobs WHERE task_name='poc_noop'"))

    print("\n§4.7 定案验证通过：SQLAlchemyPsycopg2Connector 支持业务写与 defer 同事务原子提交/回滚。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
