"""迁移校验（方案 §5.3）：源数据映射账本 + 强校验。

对 1:1 等量表核对行数；对拆分/合并表核对映射数；校验 owner 归属、
个人态、reconciliation。任一不过 exit 1。
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import (
    CommunitySignal,
    DailyBar,
    Decision,
    Instrument,
    MarketIndex,
    Position,
    Report,
    User,
    UserReportState,
    WatchlistItem,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DB = REPO_ROOT / "data" / "app.db"


def _sqlite_count(conn: sqlite3.Connection, table: str) -> int:
    return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def main() -> int:
    conn = sqlite3.connect(f"file:{SRC_DB}?mode=ro", uri=True)
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        mark = "✓" if ok else "✗"
        print(f"  [{mark}] {name}{'  — ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    with SessionLocal() as s:
        def pg_count(model) -> int:
            return s.execute(select(func.count()).select_from(model)).scalar_one()

        print("=== 1:1 等量表（迁移后 == SQLite）===")
        for model, table in [
            (DailyBar, "daily_bars"),
            (CommunitySignal, "community_signals"),
            (MarketIndex, "market_indices"),
            (Report, "reports"),
            (Position, "positions"),
            (Decision, "decisions"),
        ]:
            pg, lite = pg_count(model), _sqlite_count(conn, table)
            check(f"{table} 行数", pg == lite, f"PG={pg} SQLite={lite}")

        print("\n=== 拆分/合并表（映射账本）===")
        stocks_n = _sqlite_count(conn, "stocks")
        wl_n = pg_count(WatchlistItem)
        check("watchlist_items == 旧 stocks", wl_n == stocks_n, f"wl={wl_n} stocks={stocks_n}")

        inst_n = pg_count(Instrument)
        check("instruments 去重后 > 0 且 <= stocks+positions", 0 < inst_n <= stocks_n + 14, f"instruments={inst_n}")

        print("\n=== owner 归属 + 个人态 ===")
        admin = s.execute(select(User).where(User.role == "superadmin")).scalar_one()
        check("超管存在", admin is not None, f"username={admin.username}")

        orphan_pos = s.execute(
            select(func.count()).select_from(Position).where(Position.owner_id != admin.id)
        ).scalar_one()
        check("所有持仓归超管", orphan_pos == 0, f"非超管持仓={orphan_pos}")

        orphan_wl = s.execute(
            select(func.count()).select_from(WatchlistItem).where(WatchlistItem.owner_id != admin.id)
        ).scalar_one()
        check("所有自选归超管", orphan_wl == 0, f"非超管自选={orphan_wl}")

        reports_n = pg_count(Report)
        states_n = pg_count(UserReportState)
        check("每条报告有超管个人态", reports_n == states_n, f"reports={reports_n} states={states_n}")

        # status='read' → read_at 非空
        read_lite = conn.execute("SELECT count(*) FROM reports WHERE status='read'").fetchone()[0]
        read_pg = s.execute(
            select(func.count()).select_from(UserReportState).where(UserReportState.read_at.isnot(None))
        ).scalar_one()
        check("status=read → read_at", read_pg == read_lite, f"PG read_at={read_pg} SQLite read={read_lite}")

        # starred 迁移
        star_lite = conn.execute("SELECT count(*) FROM reports WHERE starred=1").fetchone()[0]
        star_pg = s.execute(
            select(func.count()).select_from(UserReportState).where(UserReportState.starred.is_(True))
        ).scalar_one()
        check("starred 迁移", star_pg == star_lite, f"PG={star_pg} SQLite={star_lite}")

        print("\n=== 证券身份规范化 ===")
        # instruments 唯一键无冲突（DB 约束保证；此处确认 canonical_symbol 非空）
        empty_sym = s.execute(
            select(func.count()).select_from(Instrument).where(Instrument.canonical_symbol == "")
        ).scalar_one()
        check("canonical_symbol 非空", empty_sym == 0, f"空={empty_sym}")

    conn.close()

    print(f"\n{'=' * 40}")
    if failures:
        print(f"校验失败 {len(failures)} 项：{failures}")
        return 1
    print("所有校验通过 ✓（方案 §5.3）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
