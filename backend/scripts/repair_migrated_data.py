"""清理历史测试污染并修复 legacy 报告归属。

默认 dry-run；``--apply`` 才提交。只匹配仓库测试套件使用的随机账号命名规则，并只删除这些账号
拥有的私有资源及其失去引用的测试证券。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    AutomationTask,
    Debate,
    Instrument,
    InviteCode,
    LlmAgentRoute,
    LlmProfile,
    Position,
    Report,
    ReportAssetLink,
    User,
    UserReportState,
    UserSession,
    UserSignalState,
    WatchlistItem,
)
from app.services.report_store import delete_report_file, report_file_exists, report_root

_TEST_USER_RE = re.compile(r"^(?:au|ph|job|ra|rep|mkt|dec|sy|m7|authz|dc|an|m4|admin|member)_[0-9a-f]{8}$")
_TEST_REPORT_FILE_RE = re.compile(r"^(?:priv|shared)_[0-9a-f]{8}\.html$")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "app.db",
        help="用于限定 legacy 报告主键的 SQLite 源库",
    )
    args = parser.parse_args()
    test_report_files: list[str | None] = []
    with SessionLocal() as session:
        users = [item for item in session.execute(select(User)).scalars() if _TEST_USER_RE.match(item.username)]
        user_ids = {item.id for item in users}
        summary: dict[str, object] = {
            "mode": "apply" if args.apply else "dry-run",
            "test_users": [item.username for item in users],
        }
        summary["duplicate_automation_tasks_removed"] = _dedupe_automation_tasks(session)
        summary["debate_queue_repair"] = _repair_debate_queue(session)
        if user_ids:
            candidate_instruments = set(
                session.execute(select(Position.instrument_id).where(Position.owner_id.in_(user_ids))).scalars()
            ) | set(
                session.execute(
                    select(WatchlistItem.instrument_id).where(WatchlistItem.owner_id.in_(user_ids))
                ).scalars()
            )
            test_reports = list(session.execute(select(Report).where(Report.owner_id.in_(user_ids))).scalars())
            test_report_ids = {item.id for item in test_reports}
            candidate_instruments |= set(
                session.execute(
                    select(ReportAssetLink.instrument_id).where(ReportAssetLink.report_id.in_(test_report_ids))
                ).scalars()
            )
            candidate_instruments |= set(
                session.execute(
                    select(Debate.instrument_id).where(
                        or_(Debate.owner_id.in_(user_ids), Debate.execution_owner_id.in_(user_ids))
                    )
                ).scalars()
            )
            test_report_files = [item.file for item in test_reports]
            summary["test_reports"] = sorted(test_report_ids)

            session.execute(delete(ReportAssetLink).where(ReportAssetLink.report_id.in_(test_report_ids)))
            session.execute(
                delete(UserReportState).where(
                    or_(UserReportState.user_id.in_(user_ids), UserReportState.report_id.in_(test_report_ids))
                )
            )
            session.execute(delete(Report).where(Report.id.in_(test_report_ids)))
            session.execute(
                delete(Debate).where(or_(Debate.owner_id.in_(user_ids), Debate.execution_owner_id.in_(user_ids)))
            )
            session.execute(delete(Position).where(Position.owner_id.in_(user_ids)))
            session.execute(delete(WatchlistItem).where(WatchlistItem.owner_id.in_(user_ids)))
            session.execute(delete(UserSignalState).where(UserSignalState.user_id.in_(user_ids)))
            session.execute(delete(LlmAgentRoute).where(LlmAgentRoute.user_id.in_(user_ids)))
            session.execute(delete(LlmProfile).where(LlmProfile.user_id.in_(user_ids)))
            session.execute(delete(UserSession).where(UserSession.user_id.in_(user_ids)))
            session.execute(delete(InviteCode).where(InviteCode.created_by.in_(user_ids)))
            session.execute(delete(AutomationTask).where(AutomationTask.execution_owner_id.in_(user_ids)))
            session.execute(delete(User).where(User.id.in_(user_ids)))
            session.flush()

            orphan_instruments: list[str] = []
            for instrument_id in candidate_instruments:
                references = 0
                for model in (Position, WatchlistItem, Debate, ReportAssetLink):
                    references += session.execute(
                        select(func.count()).select_from(model).where(model.instrument_id == instrument_id)
                    ).scalar_one()
                if references == 0:
                    session.execute(delete(Instrument).where(Instrument.id == instrument_id))
                    orphan_instruments.append(str(instrument_id))
            summary["orphan_test_instruments"] = orphan_instruments

        admin = session.execute(
            select(User).where(User.role == "superadmin", User.username == get_settings().superadmin_username)
        ).scalar_one_or_none()
        if admin is not None:
            # 当前 schema 升级前的数据均来自 legacy 迁移；源主键修复由 import_sqlite/verify_migration 精确复核。
            source_ids = _source_report_ids(args.source)
            if source_ids:
                session.execute(
                    update(Report).where(Report.id.in_(source_ids)).values(owner_id=admin.id, visibility="shared")
                )
        all_reports = list(session.execute(select(Report)).scalars())
        referenced_files = {item.file for item in all_reports if item.file}
        orphan_test_report_files = _orphan_test_report_files(referenced_files)
        summary["orphan_test_report_files"] = orphan_test_report_files
        status_updates = 0
        for report in all_reports:
            actual = "ok" if report_file_exists(report.file) else "missing"
            if report.content_status != actual:
                report.content_status = actual
                status_updates += 1
        summary["content_status_updates"] = status_updates

        if args.apply:
            session.commit()
            files_to_delete = set(test_report_files) | set(orphan_test_report_files)
            summary["test_report_files_deleted"] = sum(delete_report_file(file) for file in files_to_delete)
        else:
            session.rollback()
        print(summary)
        if not args.apply:
            print("dry-run 已回滚；确认后使用 --apply")
    return 0


def _dedupe_automation_tasks(session: Session) -> list[str]:
    """合并迁移产生的同 owner、同业务定义系统任务，保留最近修改的一条。"""
    rows = list(session.execute(select(AutomationTask).where(AutomationTask.scope == "system")).scalars())
    groups: dict[tuple[object, ...], list[AutomationTask]] = {}
    for task in rows:
        fingerprint = (
            task.execution_owner_id,
            task.name.strip(),
            task.goal or "",
            task.implementation or "",
            task.prompt or "",
            task.schedule or "",
            json.dumps(task.config or {}, ensure_ascii=False, sort_keys=True, default=str),
        )
        groups.setdefault(fingerprint, []).append(task)
    removed: list[str] = []
    for duplicates in groups.values():
        if len(duplicates) < 2:
            continue
        survivor = max(duplicates, key=lambda item: (item.updated_at, str(item.id)))
        for task in duplicates:
            if task.id == survivor.id:
                continue
            removed.append(str(task.id))
            session.delete(task)
    return removed


def _repair_debate_queue(session: Session) -> dict[str, object]:
    """清理已删除辩论留下的 job，并让每场活跃辩论只关联一个当前命名空间任务。"""
    jobs = list(
        session.execute(
            text(
                "SELECT id, task_name, args FROM procrastinate_jobs "
                "WHERE status='todo' AND task_name IN ('run_debate', 'fk:run_debate') "
                "ORDER BY id FOR UPDATE"
            )
        ).mappings()
    )
    debates = {
        item.id: item
        for item in session.execute(select(Debate).where(Debate.status.in_(("queued", "running")))).scalars()
    }
    grouped: dict[str, list[dict[str, Any]]] = {}
    removed: list[int] = []
    for raw_row in jobs:
        row = dict(raw_row)
        job_args = row["args"] if isinstance(row["args"], dict) else {}
        debate_id = str(job_args.get("debate_id") or "")
        if debate_id not in debates:
            removed.append(int(row["id"]))
            continue
        grouped.setdefault(debate_id, []).append(dict(row))

    linked: dict[str, int] = {}
    renamed: list[int] = []
    missing: list[str] = []
    for debate_id, debate in debates.items():
        candidates = grouped.get(debate_id, [])
        if not candidates:
            missing.append(debate_id)
            continue
        recorded = next((row for row in candidates if int(row["id"]) == debate.queue_job_id), None)
        namespaced = [row for row in candidates if row["task_name"] == "fk:run_debate"]
        keep = recorded or (namespaced[0] if namespaced else candidates[0])
        keep_id = int(keep["id"])
        removed.extend(int(row["id"]) for row in candidates if int(row["id"]) != keep_id)
        if keep["task_name"] != "fk:run_debate":
            session.execute(
                text("UPDATE procrastinate_jobs SET task_name='fk:run_debate' WHERE id=:job_id"),
                {"job_id": keep_id},
            )
            renamed.append(keep_id)
        debate.queue_job_id = keep_id
        linked[debate_id] = keep_id

    for job_id in sorted(set(removed)):
        session.execute(text("DELETE FROM procrastinate_events WHERE job_id=:job_id"), {"job_id": job_id})
        session.execute(text("DELETE FROM procrastinate_jobs WHERE id=:job_id"), {"job_id": job_id})
    return {
        "jobs_removed": sorted(set(removed)),
        "legacy_task_names_updated": renamed,
        "active_debates_linked": linked,
        "active_debates_missing_job": missing,
    }


def _source_report_ids(source: Path) -> set[str]:
    import sqlite3

    if not source.exists():
        return set()
    conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        return {str(row[0]) for row in conn.execute("SELECT id FROM reports")}
    finally:
        conn.close()


def _orphan_test_report_files(referenced_files: set[str]) -> list[str]:
    """只识别历史 authz 测试的精确文件名，且绝不删除仍被报告行引用的文件。"""
    root = report_root()
    if not root.exists():
        return []
    candidates: list[str] = []
    for path in root.rglob("*.html"):
        relative = path.relative_to(root).as_posix()
        if relative not in referenced_files and _TEST_REPORT_FILE_RE.fullmatch(path.name):
            candidates.append(relative)
    return sorted(candidates)


if __name__ == "__main__":
    raise SystemExit(main())
