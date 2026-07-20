"""SQLite → PostgreSQL 非破坏性存量迁移。

默认执行 dry-run；显式传入 ``--apply`` 才提交。迁移通过稳定主键/UUID5 upsert，保留目标库新增数据，
并输出源快照哈希、映射计数、缺失文件和未解析证券账本。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from shutil import move
from typing import Any, cast

from argon2 import PasswordHasher
from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    AutomationTask,
    CommunitySignal,
    DailyBar,
    Debate,
    Decision,
    Instrument,
    Log,
    MarketIndex,
    Position,
    QuoteOverride,
    Report,
    ReportAssetLink,
    Setting,
    User,
    UserReportState,
    WatchlistItem,
)
from app.services.instrument_identity import merge_provider_id, normalize

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SRC_DB = DATA_DIR / "app.db"
_MIGRATION_NAMESPACE = uuid.UUID("33dcaec0-046a-4bbf-9f48-5378988c7e78")


def make_cold_snapshot(source: Path = SRC_DB) -> tuple[Path, str]:
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    snap = DATA_DIR / f"app.db.migration-snapshot-{ts}"
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(snap)
    with dst:
        src.backup(dst)
    src.close()
    integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
    dst.close()
    if integrity != "ok":
        raise SystemExit(f"冷快照 integrity_check 失败: {integrity}")
    sha = hashlib.sha256(snap.read_bytes()).hexdigest()
    print(f"[快照] {snap.name} integrity=ok sha256={sha}")
    return snap, sha


def _rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')]


def _jload(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(value) if isinstance(value, str) else value
    except (json.JSONDecodeError, TypeError) as exc:
        raise SystemExit(f"JSON 解析失败：{value!r} ({exc})") from exc


def _ts(value: Any) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError as exc:
        raise SystemExit(f"时间解析失败：{value!r} ({exc})") from exc


def _stable_uuid(kind: str, identity: Any) -> uuid.UUID:
    return uuid.uuid5(_MIGRATION_NAMESPACE, f"{kind}:{identity}")


def _report_file_status(filename: str | None) -> str:
    if not filename:
        return "missing"
    if (DATA_DIR / "reports" / filename).exists() or (DATA_DIR / filename).exists():
        return "ok"
    return "missing"


def _ensure_admin(session: Any, now: datetime) -> User:
    settings = get_settings()
    admin = cast(
        User | None,
        session.execute(select(User).where(User.username == settings.superadmin_username)).scalar_one_or_none(),
    )
    if admin is not None:
        if admin.role != "superadmin":
            raise SystemExit(f"用户名 {settings.superadmin_username} 已存在但不是超管")
        return admin
    if not settings.superadmin_password:
        raise SystemExit("首次迁移须配置 FINANCE_KNOWLEDGE_SUPERADMIN_PASSWORD")
    admin = User(
        id=uuid.uuid4(),
        username=settings.superadmin_username,
        password_hash=PasswordHasher().hash(settings.superadmin_password),
        role="superadmin",
        status="active",
        created_at=now,
        updated_at=now,
    )
    session.add(admin)
    session.flush()
    return admin


def run_import(snapshot: Path, source_sha256: str, *, apply: bool) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    now = datetime.now(UTC)
    ledger: dict[str, Any] = {
        "mode": "apply" if apply else "dry-run",
        "snapshot": str(snapshot),
        "source_sha256": source_sha256,
        "started_at": now.isoformat(),
        "counts": {},
        "mappings": {},
        "reconciliation": {
            "unresolved_instruments": [],
            "missing_report_files": [],
            "orphan_html": [],
        },
    }
    try:
        with SessionLocal() as session:
            admin = _ensure_admin(session, now)
            stocks = _rows(conn, "stocks")
            positions = _rows(conn, "positions")
            secid_rows = {str(row["code"]): row for row in _rows(conn, "secid_map")}
            instruments = _upsert_instruments(session, stocks, positions, secid_rows, ledger, now)
            _upsert_public_data(conn, session)
            _upsert_reports_and_private_data(
                conn,
                session,
                admin,
                stocks,
                positions,
                secid_rows,
                instruments,
                ledger,
                now,
            )
            _upsert_system_data(conn, session, admin, ledger, now)
            _cleanup_orphan_legacy_instruments(session, ledger)
            _reconcile_report_files(session, ledger)
            ledger["completed_at"] = datetime.now(UTC).isoformat()
            if apply:
                session.commit()
            else:
                session.rollback()
    finally:
        conn.close()
    return ledger


def _upsert_instruments(
    session: Any,
    stocks: list[dict[str, Any]],
    positions: list[dict[str, Any]],
    secid_rows: dict[str, dict[str, Any]],
    ledger: dict[str, Any],
    now: datetime,
) -> dict[tuple[str, str, str], Instrument]:
    by_key = {
        (item.exchange, item.asset_class, item.canonical_symbol): item
        for item in session.execute(select(Instrument)).scalars()
    }

    def ensure(code: str, market: str | None, name: str = "") -> Instrument | None:
        source_row = secid_rows.get(str(code))
        secid = str(source_row.get("secid") or "") if source_row else ""
        market = _correct_market_from_secid(market, secid)
        normalized = normalize(code, market)
        if normalized is None:
            ledger["reconciliation"]["unresolved_instruments"].append({"code": code, "market": market})
            return None
        key = (normalized.exchange, normalized.asset_class, normalized.canonical_symbol)
        item = by_key.get(key)
        source_row = source_row or secid_rows.get(normalized.canonical_symbol)
        provider_ids = dict(item.provider_ids or {}) if item else {}
        if source_row:
            provider_ids = merge_provider_id(provider_ids, source_row["secid"], source_row["kind"])
        if item is None:
            item = Instrument(
                id=_stable_uuid("instrument", "|".join(key)),
                asset_class=normalized.asset_class,
                exchange=normalized.exchange,
                canonical_symbol=normalized.canonical_symbol,
                display_code=normalized.display_code,
                name=name or normalized.display_code,
                market=market or "",
                provider_ids=provider_ids,
                source="migration",
                active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(item)
            by_key[key] = item
        else:
            item.provider_ids = provider_ids
            if name:
                item.name = name
            item.updated_at = now
        ledger["mappings"][f"instrument:{code}:{market or ''}"] = str(item.id)
        return item

    for row in [*stocks, *positions]:
        ensure(str(row["code"]), row.get("market"), row.get("name", ""))
    session.flush()
    ledger["counts"]["instruments"] = len(by_key)
    return by_key


def _upsert_public_data(conn: sqlite3.Connection, session: Any) -> None:
    for row in _rows(conn, "daily_bars"):
        session.merge(
            DailyBar(
                secid=row["secid"],
                date=row["date"],
                close=row.get("close"),
                volume=row.get("volume"),
                updated_at=_ts(row.get("updated_at")),
            )
        )
    for row in _rows(conn, "market_indices"):
        session.merge(
            MarketIndex(
                code=row["code"],
                region=row["region"],
                name=row["name"],
                level=row.get("level"),
                change_pct=row.get("change_pct"),
                volume=row.get("volume"),
                related_etfs=_jload(row.get("related_etfs"), []),
                updated_at=_ts(row.get("updated_at")),
            )
        )
    for row in _rows(conn, "community_signals"):
        session.merge(
            CommunitySignal(
                id=row["id"],
                date=row["date"],
                source=row["source"],
                source_title=row.get("source_title"),
                source_url=row.get("source_url"),
                theme=row.get("theme"),
                industry=row.get("industry"),
                related_assets=_jload(row.get("related_assets"), []),
                signal_type=row.get("signal_type"),
                summary=row.get("summary"),
                evidence=row.get("evidence"),
                confidence=row.get("confidence") or "medium",
                verification_status=row.get("verification_status") or "待验证",
                importance=row.get("importance") or 3,
                observed_at=row.get("observed_at"),
                imported_at=row.get("imported_at"),
                expires_at=row.get("expires_at"),
                signal_metadata=_jload(row.get("metadata"), {}),
                created_at=_ts(row.get("created_at")),
                updated_at=_ts(row.get("updated_at")),
            )
        )
    for row in _rows(conn, "quote_overrides"):
        session.merge(
            QuoteOverride(
                code=row["code"],
                name=row.get("name"),
                market=row.get("market"),
                price=row["price"],
                change_pct=row.get("change_pct"),
                source_label=row.get("source_label") or "手动行情",
                note=row.get("note"),
                updated_at=_ts(row.get("updated_at")),
            )
        )


def _find_instrument(
    instruments: dict[tuple[str, str, str], Instrument],
    code: str,
    market: str | None,
    secid_rows: dict[str, dict[str, Any]],
) -> Instrument | None:
    source = secid_rows.get(str(code)) or {}
    market = _correct_market_from_secid(market, str(source.get("secid") or ""))
    normalized = normalize(code, market)
    if normalized is None:
        return None
    return instruments.get((normalized.exchange, normalized.asset_class, normalized.canonical_symbol))


def _upsert_reports_and_private_data(
    conn: sqlite3.Connection,
    session: Any,
    admin: User,
    stocks: list[dict[str, Any]],
    positions: list[dict[str, Any]],
    secid_rows: dict[str, dict[str, Any]],
    instruments: dict[tuple[str, str, str], Instrument],
    ledger: dict[str, Any],
    now: datetime,
) -> None:
    report_rows = _rows(conn, "reports")
    for row in report_rows:
        meta: dict[str, Any] = {}
        if row.get("accent"):
            meta["accent"] = row["accent"]
        if row.get("wiki_path"):
            meta["wiki_path"] = row["wiki_path"]
        status = _report_file_status(row.get("file"))
        if status != "ok":
            ledger["reconciliation"]["missing_report_files"].append(row.get("file") or f"{row['id']}:无文件名")
        session.merge(
            Report(
                id=row["id"],
                owner_id=admin.id,
                visibility="shared",
                title=row["title"],
                topic=row["topic"],
                type=row["type"],
                type_label=row.get("type_label"),
                summary=row.get("summary"),
                origin=row.get("origin"),
                origin_label=row.get("origin_label"),
                source=row.get("source"),
                file=row.get("file"),
                local_date=row.get("local_date"),
                tags=_jload(row.get("tags"), []),
                highlights=_jload(row.get("highlights"), []),
                meta=meta,
                content_status=status,
                created_at=_ts(row.get("created_at")),
                updated_at=_ts(row.get("updated_at")),
            )
        )
        session.merge(
            UserReportState(
                user_id=admin.id,
                report_id=row["id"],
                read_at=_ts(row.get("updated_at")) if row.get("status") == "read" else None,
                starred=bool(row.get("starred")),
                archived=bool(row.get("archived")),
                updated_at=now,
            )
        )
    ledger["counts"]["reports"] = len(report_rows)

    existing_watchlist = list(
        session.execute(
            select(WatchlistItem, Instrument)
            .join(Instrument, Instrument.id == WatchlistItem.instrument_id)
            .where(WatchlistItem.owner_id == admin.id)
        ).all()
    )
    for row in stocks:
        inst = _find_instrument(instruments, row["code"], row.get("market"), secid_rows)
        if inst is None:
            continue
        candidates = [
            item
            for item, candidate_inst in existing_watchlist
            if candidate_inst.canonical_symbol == inst.canonical_symbol and candidate_inst.source == "migration"
        ]
        item = next((candidate for candidate in candidates if candidate.instrument_id == inst.id), None)
        item = item or (candidates[0] if len(candidates) == 1 else None)
        if item is None:
            item = WatchlistItem(
                id=_stable_uuid("watchlist", f"{admin.id}:{inst.id}"),
                owner_id=admin.id,
                instrument_id=inst.id,
            )
            session.add(item)
            existing_watchlist.append((item, inst))
        item.instrument_id = inst.id
        item.status = row.get("status") or "观察"
        item.thesis = row.get("thesis")
        item.advice = row.get("advice")
        item.risk = row.get("risk")
        item.watch_signals = _jload(row.get("watch_signals"), [])
        item.sparkline = _jload(row.get("sparkline"), [])
        item.analysis_status = row.get("analysis_status") or "pending"
        item.created_at = item.created_at or now
        item.updated_at = _ts(row.get("updated_at"))
        ledger["mappings"][f"watchlist:{row['code']}"] = str(item.id)
    ledger["counts"]["watchlist_items"] = len(stocks)

    existing_positions = list(
        session.execute(
            select(Position, Instrument)
            .join(Instrument, Instrument.id == Position.instrument_id)
            .where(Position.owner_id == admin.id)
        ).all()
    )
    used_position_ids: set[uuid.UUID] = set()
    migrated_positions = 0
    for index, row in enumerate(positions):
        inst = _find_instrument(instruments, row["code"], row.get("market"), secid_rows)
        if inst is None:
            continue
        source_identity = row.get("id") or f"{row['code']}:{index}"
        candidates = [
            item
            for item, candidate_inst in existing_positions
            if item.id not in used_position_ids
            and candidate_inst.canonical_symbol == inst.canonical_symbol
            and candidate_inst.source == "migration"
            and _same_number(item.shares, row.get("shares") or 0)
            and _same_number(item.cost, row.get("cost") or 0)
        ]
        item = next((candidate for candidate in candidates if candidate.instrument_id == inst.id), None)
        item = item or (candidates[0] if len(candidates) == 1 else None)
        if item is None:
            item = Position(
                id=_stable_uuid("position", f"{admin.id}:{source_identity}"),
                owner_id=admin.id,
                instrument_id=inst.id,
            )
            session.add(item)
            existing_positions.append((item, inst))
        item.instrument_id = inst.id
        item.shares = row.get("shares") or 0
        item.cost = row.get("cost") or 0
        item.reason = row.get("reason")
        item.risk = row.get("risk")
        item.analysis_status = row.get("analysis_status") or "pending"
        item.created_at = item.created_at or now
        item.updated_at = _ts(row.get("updated_at"))
        used_position_ids.add(item.id)
        ledger["mappings"][f"position:{source_identity}"] = str(item.id)
        migrated_positions += 1
    ledger["counts"]["positions"] = migrated_positions


def _correct_market_from_secid(market: str | None, secid: str) -> str | None:
    """provider 身份优先于旧人工 market 标签，避免基金被迁成 A 股。"""
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


def _upsert_system_data(
    conn: sqlite3.Connection,
    session: Any,
    admin: User,
    ledger: dict[str, Any],
    now: datetime,
) -> None:
    for row in _rows(conn, "settings"):
        session.merge(Setting(key=row["key"], value=_jload(row.get("value"), None)))
    for row in _rows(conn, "logs"):
        session.merge(
            Log(
                id=row["id"],
                type=row.get("type"),
                message=row.get("message"),
                log_metadata=_jload(row.get("meta"), {}),
                created_at=row.get("created_at"),
                local_time=row.get("local_time"),
            )
        )
    task_rows = _rows(conn, "automation_tasks")
    existing_tasks = list(
        session.execute(
            select(AutomationTask).where(
                AutomationTask.scope == "system",
                AutomationTask.execution_owner_id == admin.id,
            )
        ).scalars()
    )
    claimed_task_ids: set[uuid.UUID] = set()
    for index, row in enumerate(task_rows):
        identity = row.get("id") or f"{row.get('name')}:{index}"
        stable_id = _stable_uuid("automation", identity)
        task = session.get(AutomationTask, stable_id)
        if task is None:
            candidates = [
                item
                for item in existing_tasks
                if item.id not in claimed_task_ids and item.name.strip() == str(row["name"]).strip()
            ]
            task = candidates[0] if len(candidates) == 1 else None
        if task is None:
            task = AutomationTask(
                id=_stable_uuid("automation", identity),
                name=row["name"],
                scope="system",
                execution_owner_id=admin.id,
                enabled=bool(row.get("enabled")),
                goal=row.get("goal"),
                implementation=row.get("implementation"),
                prompt=row.get("prompt"),
                schedule=row.get("schedule"),
                config={},
                created_at=_ts(row.get("created_at")),
                updated_at=_ts(row.get("updated_at")),
            )
            session.add(task)
            existing_tasks.append(task)
        claimed_task_ids.add(task.id)
    ledger["counts"]["automation_tasks"] = len(task_rows)
    for row in _rows(conn, "decisions"):
        session.merge(
            Decision(
                id=row["id"],
                owner_id=admin.id,
                visibility="private",
                date=row.get("date"),
                title=row["title"],
                summary=row.get("summary"),
                action=row.get("action"),
                market=row.get("market"),
                position_advice=_jload(row.get("position_advice"), []),
                stock_advice=_jload(row.get("stock_advice"), []),
                reports=_jload(row.get("reports"), []),
                created_at=row.get("created_at"),
            )
        )


def _cleanup_orphan_legacy_instruments(session: Any, ledger: dict[str, Any]) -> None:
    # SessionLocal 关闭了 autoflush。先把持仓/自选的证券重绑写入数据库，
    # 否则引用计数仍看到旧主键，可能把刚接管的新证券误判为孤儿并触发 FK 错误。
    session.flush()
    removed: list[str] = []
    rows = list(session.execute(select(Instrument).where(Instrument.source == "migration")).scalars())
    for instrument in rows:
        references = sum(
            session.execute(
                select(func.count()).select_from(model).where(model.instrument_id == instrument.id)
            ).scalar_one()
            for model in (Position, WatchlistItem, Debate, ReportAssetLink)
        )
        if references == 0:
            removed.append(str(instrument.id))
            session.delete(instrument)
    ledger["reconciliation"]["orphan_legacy_instruments_removed"] = removed


def _reconcile_report_files(session: Any, ledger: dict[str, Any]) -> None:
    """只隔离整个目标库都未引用的文件，保留迁移后在 PostgreSQL 新增的报告。"""
    session.flush()
    db_files = {str(filename) for filename in session.execute(select(Report.file)).scalars() if filename}
    reports_dir = DATA_DIR / "reports"
    disk_html = set()
    if reports_dir.exists():
        for path in reports_dir.rglob("*.html"):
            relative = path.relative_to(reports_dir)
            if relative.parts and relative.parts[0] == "_orphaned":
                continue
            disk_html.add(str(relative))
    ledger["reconciliation"]["orphan_html"] = sorted(disk_html - db_files)


def _quarantine_orphan_html(ledger: dict[str, Any]) -> None:
    """把账本确认的无引用 HTML 可逆移动到独立目录，不直接删除业务文件。"""
    reports_dir = (DATA_DIR / "reports").resolve()
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    destination_root = reports_dir / "_orphaned" / stamp
    moved: dict[str, str] = {}
    for relative_text in ledger["reconciliation"].get("orphan_html", []):
        source = (reports_dir / relative_text).resolve()
        if reports_dir not in source.parents or not source.is_file():
            continue
        destination = destination_root / relative_text
        destination.parent.mkdir(parents=True, exist_ok=True)
        move(str(source), str(destination))
        moved[relative_text] = str(destination.relative_to(reports_dir))
    ledger["reconciliation"]["orphan_html_quarantined"] = moved


def _write_ledger(ledger: dict[str, Any]) -> Path:
    directory = DATA_DIR / "migration-ledgers"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    output = directory / f"sqlite-to-postgres-{stamp}-{ledger['mode']}.json"
    output.write_text(json.dumps(ledger, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="提交迁移；省略时只 dry-run 并回滚")
    parser.add_argument(
        "--quarantine-orphans",
        action="store_true",
        help="apply 成功后把无数据库引用的 HTML 移入 reports/_orphaned/<timestamp>",
    )
    parser.add_argument("--source", type=Path, default=SRC_DB)
    args = parser.parse_args()
    if not args.source.exists():
        raise SystemExit(f"源库不存在: {args.source}")
    if args.quarantine_orphans and not args.apply:
        raise SystemExit("--quarantine-orphans 必须与 --apply 同时使用；先 dry-run 核对 orphan_html")
    snapshot, source_sha256 = make_cold_snapshot(args.source)
    ledger = run_import(snapshot, source_sha256, apply=args.apply)
    if args.quarantine_orphans:
        _quarantine_orphan_html(ledger)
    ledger_path = _write_ledger(ledger)
    print(json.dumps(ledger, ensure_ascii=False, indent=2, default=str))
    print(f"映射账本：{ledger_path}")
    if not args.apply:
        print("dry-run 已回滚；确认账本后使用 --apply 提交")
    return 0


if __name__ == "__main__":
    sys.exit(main())
