"""SQLite → PostgreSQL 迁移强校验。

以源记录主键/稳定映射逐条验证，允许目标库存在迁移后新增数据；所有 legacy 报告和私人数据
必须满足归属规则，正文缺失必须显式标记为 missing。任一失败返回非零。
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text

from app.db import SessionLocal
from app.models import (
    AutomationTask,
    CommunitySignal,
    DailyBar,
    Debate,
    Instrument,
    Position,
    Report,
    User,
    UserReportState,
    WatchlistItem,
)
from app.services.instrument_identity import normalize
from scripts.import_sqlite import load_legacy_secid_rows

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SRC_DB = DATA_DIR / "app.db"
_TEST_USER_RE = re.compile(r"^(?:au|ph|job|ra|rep|mkt|dec|sy|m7|authz|dc|an|m4|admin|member)_[0-9a-f]{8}$")


def _rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')]


def _file_exists(filename: str | None, data_dir: Path) -> bool:
    return bool(filename and ((data_dir / "reports" / filename).exists() or (data_dir / filename).exists()))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SRC_DB, help="待核对的 legacy SQLite 数据库")
    parser.add_argument(
        "--data-dir",
        type=Path,
        help="legacy 报告文件所在数据目录；默认使用 source 的父目录",
    )
    args = parser.parse_args()
    source = args.source.resolve()
    data_dir = args.data_dir.resolve() if args.data_dir else source.parent
    if not source.exists():
        raise SystemExit(f"源库不存在: {source}")
    conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    failures: list[dict[str, Any]] = []

    def check(name: str, ok: bool, detail: Any = "") -> None:
        print(f"  [{'✓' if ok else '✗'}] {name}{f' — {detail}' if detail else ''}")
        if not ok:
            failures.append({"name": name, "detail": detail})

    with SessionLocal() as session:
        admins = list(session.execute(select(User).where(User.role == "superadmin")).scalars())
        check("恰好一个超管", len(admins) == 1, [item.username for item in admins])
        if not admins:
            return 1
        admin = admins[0]

        print("=== legacy 主键覆盖 ===")
        report_rows = _rows(conn, "reports")
        report_ids = {str(row["id"]) for row in report_rows}
        reports = {item.id: item for item in session.execute(select(Report).where(Report.id.in_(report_ids))).scalars()}
        check(
            "legacy reports 全部存在", set(reports) == report_ids, f"expected={len(report_ids)} actual={len(reports)}"
        )
        bad_report_owners = [item.id for item in reports.values() if item.owner_id != admin.id]
        bad_report_visibility = [item.id for item in reports.values() if item.visibility != "shared"]
        check("legacy reports 全部归超管", not bad_report_owners, bad_report_owners[:10])
        check("legacy reports 全部共享", not bad_report_visibility, bad_report_visibility[:10])
        bad_content_status = [
            item.id
            for item in reports.values()
            if item.content_status != ("ok" if _file_exists(item.file, data_dir) else "missing")
        ]
        check("legacy 正文状态与磁盘一致", not bad_content_status, bad_content_status[:10])

        states = {
            item.report_id
            for item in session.execute(
                select(UserReportState).where(
                    UserReportState.user_id == admin.id,
                    UserReportState.report_id.in_(report_ids),
                )
            ).scalars()
        }
        check("每条 legacy 报告有超管个人态", states == report_ids, f"missing={sorted(report_ids - states)[:10]}")

        signal_ids = {str(row["id"]) for row in _rows(conn, "community_signals")}
        migrated_signal_ids = set(
            session.execute(select(CommunitySignal.id).where(CommunitySignal.id.in_(signal_ids))).scalars()
        )
        check(
            "community_signals 主键全覆盖",
            migrated_signal_ids == signal_ids,
            f"missing={len(signal_ids - migrated_signal_ids)}",
        )

        bar_keys = {(str(row["secid"]), str(row["date"])) for row in _rows(conn, "daily_bars")}
        migrated_bar_keys = set(
            session.execute(
                select(DailyBar.secid, DailyBar.date).where(DailyBar.secid.in_({key[0] for key in bar_keys}))
            ).all()
        )
        check(
            "daily_bars 复合主键全覆盖", bar_keys <= migrated_bar_keys, f"missing={len(bar_keys - migrated_bar_keys)}"
        )

        print("=== 私人数据归属与证券映射 ===")
        secid_map = {code: str(row["secid"]) for code, row in load_legacy_secid_rows(conn).items()}
        source_positions = _rows(conn, "positions")
        all_admin_positions = list(
            session.execute(
                select(Position, Instrument)
                .join(Instrument, Instrument.id == Position.instrument_id)
                .where(Position.owner_id == admin.id)
            ).all()
        )
        position_failures: list[dict[str, Any]] = []
        matched_position_ids: set[uuid.UUID] = set()
        for row in source_positions:
            secid = secid_map.get(str(row["code"]), "")
            market = _correct_market(row.get("market"), secid)
            normalized = normalize(row["code"], market)
            if normalized is None:
                position_failures.append({"code": row["code"], "reason": "normalize_failed"})
                continue
            source_matches = [
                (position, instrument)
                for position, instrument in all_admin_positions
                if position.id not in matched_position_ids
                and instrument.source == "migration"
                and instrument.canonical_symbol == normalized.canonical_symbol
                and _same_number(position.shares, row.get("shares") or 0)
                and _same_number(position.cost, row.get("cost") or 0)
            ]
            correct = [
                (position, instrument)
                for position, instrument in source_matches
                if (instrument.exchange, instrument.asset_class, instrument.canonical_symbol)
                == (normalized.exchange, normalized.asset_class, normalized.canonical_symbol)
            ]
            if not correct:
                position_failures.append(
                    {"code": row["code"], "expected": [normalized.exchange, normalized.asset_class]}
                )
                continue
            matched_position_ids.add(correct[0][0].id)
            wrong = [
                str(position.id) for position, instrument in source_matches if (position, instrument) not in correct
            ]
            if wrong:
                position_failures.append({"code": row["code"], "stale_wrong_identity": wrong})
        check("legacy positions 身份与数值全覆盖", not position_failures, position_failures[:10])
        check("legacy positions 全部归超管", len(matched_position_ids) == len(source_positions))

        stocks = _rows(conn, "stocks")
        expected_watchlist_instruments: set[uuid.UUID] = set()
        unresolved: list[dict[str, Any]] = []
        instruments = list(session.execute(select(Instrument)).scalars())
        by_identity = {(item.exchange, item.asset_class, item.canonical_symbol): item for item in instruments}
        for row in stocks:
            market = row.get("market")
            secid = secid_map.get(str(row["code"]), "")
            if secid.startswith("116."):
                market = "港股"
            elif secid.startswith(("105.", "106.")):
                market = "美股"
            elif secid.startswith(("OF.", "150.")):
                market = "基金"
            normalized = normalize(row["code"], market)
            if normalized is None:
                unresolved.append({"code": row["code"], "market": market})
                continue
            instrument = by_identity.get((normalized.exchange, normalized.asset_class, normalized.canonical_symbol))
            if instrument is None:
                unresolved.append({"code": row["code"], "market": market, "reason": "target_missing"})
                continue
            expected_watchlist_instruments.add(instrument.id)
        migrated_watchlist = list(
            session.execute(
                select(WatchlistItem).where(
                    WatchlistItem.owner_id == admin.id,
                    WatchlistItem.instrument_id.in_(expected_watchlist_instruments),
                )
            ).scalars()
        )
        check("证券映射无未解析项", not unresolved, unresolved[:10])
        check(
            "legacy watchlist 身份全覆盖",
            len(migrated_watchlist) == len(expected_watchlist_instruments),
            f"expected={len(expected_watchlist_instruments)} actual={len(migrated_watchlist)}",
        )
        check("legacy watchlist 全部归超管", all(item.owner_id == admin.id for item in migrated_watchlist))

        print("=== 目标库一致性与污染检查 ===")
        false_ok = [
            item.id
            for item in session.execute(select(Report).where(Report.content_status == "ok")).scalars()
            if not _file_exists(item.file, data_dir)
        ]
        check("不存在 content_status=ok 但正文缺失", not false_ok, false_ok[:10])
        test_users = [
            item.username for item in session.execute(select(User)).scalars() if _TEST_USER_RE.match(item.username)
        ]
        check("业务库无测试账号", not test_users, test_users[:20])
        orphan_private = session.execute(
            select(func.count()).select_from(Position).where(Position.owner_id.is_(None))
        ).scalar_one()
        check("持仓不存在空 owner", orphan_private == 0, orphan_private)
        duplicate_tasks = session.execute(
            select(AutomationTask.execution_owner_id, AutomationTask.name, func.count())
            .where(AutomationTask.scope == "system")
            .group_by(AutomationTask.execution_owner_id, AutomationTask.name)
            .having(func.count() > 1)
        ).all()
        check("系统自动化任务无重复", not duplicate_tasks, duplicate_tasks)

        active_debates = {
            item.id: item
            for item in session.execute(select(Debate).where(Debate.status.in_(("queued", "running")))).scalars()
        }
        debate_jobs = list(
            session.execute(
                text(
                    "SELECT id, task_name, args FROM procrastinate_jobs "
                    "WHERE status='todo' AND task_name IN ('run_debate', 'fk:run_debate') ORDER BY id"
                )
            ).mappings()
        )
        jobs_by_debate: dict[str, list[dict[str, Any]]] = {}
        orphan_jobs: list[int] = []
        for raw_row in debate_jobs:
            row = dict(raw_row)
            job_args = row["args"] if isinstance(row["args"], dict) else {}
            debate_id = str(job_args.get("debate_id") or "")
            if debate_id not in active_debates:
                orphan_jobs.append(int(row["id"]))
                continue
            jobs_by_debate.setdefault(debate_id, []).append(dict(row))
        queue_issues = []
        for debate_id, debate in active_debates.items():
            jobs = jobs_by_debate.get(debate_id, [])
            if len(jobs) != 1 or jobs[0]["task_name"] != "fk:run_debate" or int(jobs[0]["id"]) != debate.queue_job_id:
                queue_issues.append(
                    {
                        "debate_id": debate_id,
                        "queue_job_id": debate.queue_job_id,
                        "jobs": [dict(row) for row in jobs],
                    }
                )
        check(
            "活跃辩论队列一一对应",
            not orphan_jobs and not queue_issues,
            {"orphan": orphan_jobs, "issues": queue_issues},
        )

    conn.close()
    print("=" * 48)
    if failures:
        print(json.dumps({"ok": False, "failures": failures}, ensure_ascii=False, indent=2, default=str))
        return 1
    print(json.dumps({"ok": True, "message": "迁移与归属校验全部通过"}, ensure_ascii=False))
    return 0


def _correct_market(market: str | None, secid: str) -> str | None:
    if secid.startswith("116."):
        return "港股"
    if secid.startswith(("105.", "106.")):
        return "美股"
    if secid.startswith(("OF.", "150.")):
        return "基金"
    return market


def _same_number(left: Any, right: Any) -> bool:
    try:
        return abs(float(left) - float(right)) < 0.0001
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    sys.exit(main())
