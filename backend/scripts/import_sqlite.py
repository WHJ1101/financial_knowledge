"""SQLite → PostgreSQL 存量迁移（方案 §5）。

流程（§5.2）：建超管 → instruments(规范化) → 公共数据 → reports(全字段+超管态)
→ 隔离数据(owner=超管) → automation(scope=system) → decisions(归档) → reconciliation → 校验。

安全（§5.1）：先对 app.db 做冷快照 + integrity_check，只从冷快照读；不碰原库。
幂等（§5.3）：重复执行不重复导入（先清空目标表再灌，或 upsert）。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from argon2 import PasswordHasher
from sqlalchemy import delete

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    AutomationTask,
    CommunitySignal,
    DailyBar,
    Decision,
    Instrument,
    Log,
    MarketIndex,
    Position,
    QuoteOverride,
    Report,
    Setting,
    User,
    UserReportState,
    WatchlistItem,
)
from app.services.instrument_identity import merge_provider_id, normalize

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
SRC_DB = DATA_DIR / "app.db"


def make_cold_snapshot() -> Path:
    """§5.1：用 sqlite3 .backup 生成冷快照（纳入 WAL），integrity_check，记 SHA-256。"""
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    snap = DATA_DIR / f"app.db.migration-snapshot-{ts}"
    src = sqlite3.connect(f"file:{SRC_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(snap)
    with dst:
        src.backup(dst)
    src.close()
    integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
    dst.close()
    if integrity != "ok":
        raise SystemExit(f"冷快照 integrity_check 失败: {integrity}")
    sha = hashlib.sha256(snap.read_bytes()).hexdigest()
    print(f"[快照] {snap.name}  integrity=ok  sha256={sha[:16]}…")
    return snap


def _rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]


def _jload(v, default):
    if v in (None, ""):
        return default
    try:
        return json.loads(v)
    except (json.JSONDecodeError, TypeError) as e:
        raise SystemExit(f"JSON 解析失败（§5.3 失败即停）: {v!r} ({e})") from e


def _ts(v) -> datetime:
    """旧 ISO 字符串 → aware datetime；失败即停（§4.1）。"""
    if not v:
        return datetime.now(UTC)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError as e:
        raise SystemExit(f"时间解析失败（§4.1 不静默写 NULL）: {v!r} ({e})") from e


def run_import(snapshot: Path) -> dict:
    """从冷快照导入 PG。返回映射账本供校验。"""
    conn = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    settings = get_settings()
    ledger: dict = {"reconciliation": {"unresolved_instruments": [], "missing_report_files": [], "orphan_html": []}}
    now = datetime.now(UTC)

    with SessionLocal() as s:
        # 幂等：清空目标业务表（保留 alembic/procrastinate）
        for model in (
            UserReportState, Report, Position, WatchlistItem, Decision,
            CommunitySignal, DailyBar, MarketIndex, QuoteOverride,
            AutomationTask, Log, Setting, Instrument, User,
        ):
            s.execute(delete(model))
        s.commit()

        # 1. 超管
        ph = PasswordHasher()
        admin = User(
            id=uuid.uuid4(), username=settings.superadmin_username,
            password_hash=ph.hash(settings.superadmin_password or "changeme"),
            role="superadmin", status="active", created_at=now, updated_at=now,
        )
        s.add(admin)
        s.flush()
        admin_id = admin.id

        # 2. instruments：从 stocks + positions + secid_map 归一
        instrument_by_symbol: dict[tuple[str, str, str], Instrument] = {}
        secid_rows = {r["code"]: r for r in _rows(conn, "secid_map")}

        def ensure_instrument(code: str, market: str | None, name: str = "") -> Instrument | None:
            norm = normalize(code, market)
            if norm is None:
                ledger["reconciliation"]["unresolved_instruments"].append({"code": code, "market": market})
                return None
            key = (norm.exchange, norm.asset_class, norm.canonical_symbol)
            if key in instrument_by_symbol:
                return instrument_by_symbol[key]
            provider_ids: dict[str, str] = {}
            sm = secid_rows.get(code) or secid_rows.get(norm.canonical_symbol)
            if sm:
                provider_ids = merge_provider_id(provider_ids, sm["secid"], sm["kind"])
            inst = Instrument(
                id=uuid.uuid4(), asset_class=norm.asset_class, exchange=norm.exchange,
                canonical_symbol=norm.canonical_symbol, display_code=norm.display_code,
                name=name or norm.display_code, market=(market or ""), provider_ids=provider_ids,
                source="migration", active=True, created_at=now, updated_at=now,
            )
            s.add(inst)
            instrument_by_symbol[key] = inst
            return inst

        stocks = _rows(conn, "stocks")
        for st in stocks:
            ensure_instrument(st["code"], st.get("market"), st.get("name", ""))
        positions = _rows(conn, "positions")
        for po in positions:
            ensure_instrument(po["code"], po.get("market"), po.get("name", ""))
        s.flush()
        ledger["instruments"] = len(instrument_by_symbol)

        # 3. 公共数据：daily_bars / market_indices / community_signals / quote_overrides
        for b in _rows(conn, "daily_bars"):
            s.add(DailyBar(secid=b["secid"], date=b["date"], close=b.get("close"),
                           volume=b.get("volume"), updated_at=_ts(b.get("updated_at"))))
        for mi in _rows(conn, "market_indices"):
            s.add(MarketIndex(code=mi["code"], region=mi["region"], name=mi["name"],
                              level=mi.get("level"), change_pct=mi.get("change_pct"),
                              volume=mi.get("volume"), related_etfs=_jload(mi.get("related_etfs"), []),
                              updated_at=_ts(mi.get("updated_at"))))
        for cs in _rows(conn, "community_signals"):
            s.add(CommunitySignal(
                id=cs["id"], date=cs["date"], source=cs["source"], source_title=cs.get("source_title"),
                source_url=cs.get("source_url"), theme=cs.get("theme"), industry=cs.get("industry"),
                related_assets=_jload(cs.get("related_assets"), []), signal_type=cs.get("signal_type"),
                summary=cs.get("summary"), evidence=cs.get("evidence"),
                confidence=cs.get("confidence") or "medium",
                verification_status=cs.get("verification_status") or "待验证",
                importance=cs.get("importance") or 3, observed_at=cs.get("observed_at"),
                imported_at=cs.get("imported_at"), expires_at=cs.get("expires_at"),
                signal_metadata=_jload(cs.get("metadata"), {}),
                created_at=_ts(cs.get("created_at")), updated_at=_ts(cs.get("updated_at")),
            ))
        for qo in _rows(conn, "quote_overrides"):
            s.add(QuoteOverride(code=qo["code"], name=qo.get("name"), market=qo.get("market"),
                                price=qo["price"], change_pct=qo.get("change_pct"),
                                source_label=qo.get("source_label") or "手动行情",
                                note=qo.get("note"), updated_at=_ts(qo.get("updated_at"))))
        s.flush()

        _import_reports_and_isolated(conn, s, admin_id, stocks, positions,
                                     instrument_by_symbol, ledger, now)
        _import_system(conn, s, admin_id, now)
        _reconcile_report_files(conn, ledger)
        s.commit()

    conn.close()
    return ledger


def _import_reports_and_isolated(conn, s, admin_id, stocks, positions, inst_map, ledger, now) -> None:
    """报告全字段迁移 + 隔离数据归超管（方案 §4.3/§5.2）。"""
    report_count = 0
    for r in _rows(conn, "reports"):
        meta = {}
        if r.get("accent"):
            meta["accent"] = r["accent"]
        if r.get("wiki_path"):
            meta["wiki_path"] = r["wiki_path"]
        visibility = "shared" if (r.get("origin") == "automation") else "private"
        s.add(Report(
            id=r["id"], owner_id=admin_id, visibility=visibility, title=r["title"], topic=r["topic"],
            type=r["type"], type_label=r.get("type_label"), summary=r.get("summary"),
            origin=r.get("origin"), origin_label=r.get("origin_label"), source=r.get("source"),
            file=r.get("file"), local_date=r.get("local_date"),
            tags=_jload(r.get("tags"), []), highlights=_jload(r.get("highlights"), []), meta=meta,
            content_status="ok", created_at=_ts(r.get("created_at")), updated_at=_ts(r.get("updated_at")),
        ))
        # 个人态：status='read'→read_at；starred/archived 迁到超管这一行
        s.add(UserReportState(
            user_id=admin_id, report_id=r["id"],
            read_at=_ts(r.get("updated_at")) if r.get("status") == "read" else None,
            starred=bool(r.get("starred")), archived=bool(r.get("archived")), updated_at=now,
        ))
        report_count += 1
    ledger["reports"] = report_count

    def find_inst(code, market):
        norm = normalize(code, market)
        if norm is None:
            return None
        return inst_map.get((norm.exchange, norm.asset_class, norm.canonical_symbol))

    wl = 0
    for st in stocks:
        inst = find_inst(st["code"], st.get("market"))
        if inst is None:
            continue
        s.add(WatchlistItem(
            id=uuid.uuid4(), owner_id=admin_id, instrument_id=inst.id,
            status=st.get("status") or "观察", thesis=st.get("thesis"), advice=st.get("advice"),
            risk=st.get("risk"), watch_signals=_jload(st.get("watch_signals"), []),
            sparkline=_jload(st.get("sparkline"), []),
            analysis_status=st.get("analysis_status") or "pending",
            created_at=now, updated_at=_ts(st.get("updated_at")),
        ))
        wl += 1
    ledger["watchlist_items"] = wl

    pos = 0
    for po in positions:
        inst = find_inst(po["code"], po.get("market"))
        if inst is None:
            continue
        s.add(Position(
            id=uuid.uuid4(), owner_id=admin_id, instrument_id=inst.id,
            shares=po.get("shares") or 0, cost=po.get("cost") or 0, reason=po.get("reason"),
            risk=po.get("risk"), analysis_status=po.get("analysis_status") or "pending",
            created_at=now, updated_at=_ts(po.get("updated_at")),
        ))
        pos += 1
    ledger["positions"] = pos


def _import_system(conn, s, admin_id, now) -> None:
    """系统管理数据 + decisions 归档（方案 §4.4）。"""
    for setting in _rows(conn, "settings"):
        s.add(Setting(key=setting["key"], value=_jload(setting.get("value"), None)))
    for log in _rows(conn, "logs"):
        s.add(Log(id=log["id"], type=log.get("type"), message=log.get("message"),
                  log_metadata=_jload(log.get("meta"), {}), created_at=log.get("created_at"),
                  local_time=log.get("local_time")))
    for at in _rows(conn, "automation_tasks"):
        s.add(AutomationTask(
            id=uuid.uuid4(), name=at["name"], scope="system", execution_owner_id=admin_id,
            enabled=bool(at.get("enabled")), goal=at.get("goal"),
            implementation=at.get("implementation"), prompt=at.get("prompt"),
            schedule=at.get("schedule"), config={}, created_at=_ts(at.get("created_at")),
            updated_at=_ts(at.get("updated_at")),
        ))
    for d in _rows(conn, "decisions"):
        s.add(Decision(
            id=d["id"], date=d.get("date"), title=d["title"], summary=d.get("summary"),
            action=d.get("action"), market=d.get("market"),
            position_advice=_jload(d.get("position_advice"), []),
            stock_advice=_jload(d.get("stock_advice"), []), reports=_jload(d.get("reports"), []),
            created_at=d.get("created_at"),
        ))


def _reconcile_report_files(conn, ledger) -> None:
    """报告 DB 记录 ↔ HTML 文件双向核对（方案 §1.2/§5.3）。"""
    reports_dir = DATA_DIR / "reports"
    db_files = {r["file"] for r in _rows(conn, "reports") if r.get("file")}
    for f in sorted(db_files):
        if not (reports_dir / f).exists() and not (DATA_DIR / f).exists():
            ledger["reconciliation"]["missing_report_files"].append(f)
    disk_html: set[str] = set()
    if reports_dir.exists():
        disk_html = {str(p.relative_to(reports_dir)) for p in reports_dir.rglob("*.html")}
    for f in sorted(disk_html - db_files):
        ledger["reconciliation"]["orphan_html"].append(f)


def main() -> int:
    if not SRC_DB.exists():
        raise SystemExit(f"源库不存在: {SRC_DB}")
    snap = make_cold_snapshot()
    ledger = run_import(snap)
    print("\n=== 迁移映射账本 ===")
    print(json.dumps(ledger, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
