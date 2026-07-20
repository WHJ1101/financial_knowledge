"""真实 SQLite 快照的非破坏性 dry-run 回归。"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select

from app.config import get_settings
from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Instrument, Position, Report, User, WatchlistItem
from scripts import import_sqlite
from scripts.import_sqlite import (
    SRC_DB,
    _cleanup_orphan_legacy_instruments,
    _reconcile_report_files,
    run_import,
)


def test_real_sqlite_dry_run_maps_all_private_data_and_rolls_back() -> None:
    admin_id = uuid.uuid4()
    now = datetime.now(UTC)
    with SessionLocal() as session:
        session.add(
            User(
                id=admin_id,
                username=get_settings().superadmin_username,
                password_hash=hash_password("test-only"),
                role="superadmin",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

    source_sha = hashlib.sha256(SRC_DB.read_bytes()).hexdigest()
    ledger = run_import(SRC_DB, source_sha, apply=False)
    assert ledger["mode"] == "dry-run"
    assert ledger["counts"]["reports"] > 0
    assert ledger["counts"]["positions"] > 0
    assert ledger["counts"]["watchlist_items"] > 0
    assert ledger["reconciliation"]["unresolved_instruments"] == []
    assert len([key for key in ledger["mappings"] if key.startswith("position:")]) == ledger["counts"]["positions"]

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Report)) == 0
        assert session.scalar(select(func.count()).select_from(Position)) == 0
        assert session.scalar(select(func.count()).select_from(WatchlistItem)) == 0
        session.execute(delete(User).where(User.id == admin_id))
        session.commit()


def test_orphan_cleanup_flushes_pending_instrument_rebind_before_counting() -> None:
    now = datetime.now(UTC)
    owner = User(
        id=uuid.uuid4(),
        username=f"migration-rebind-{uuid.uuid4().hex}",
        password_hash=hash_password("test-only"),
        role="member",
        status="active",
        created_at=now,
        updated_at=now,
    )
    old = Instrument(
        id=uuid.uuid4(),
        asset_class="equity",
        exchange="SZSE",
        canonical_symbol="001557",
        display_code="001557",
        name="错误身份",
        market="深市主板",
        provider_ids={},
        source="migration",
        active=True,
        created_at=now,
        updated_at=now,
    )
    corrected = Instrument(
        id=uuid.uuid4(),
        asset_class="open_end_fund",
        exchange="OTC_FUND",
        canonical_symbol="001557",
        display_code="001557",
        name="天弘中证500指数增强C",
        market="基金",
        provider_ids={"eastmoney": "OF.001557"},
        source="migration",
        active=True,
        created_at=now,
        updated_at=now,
    )
    with SessionLocal() as session:
        session.add_all([owner, old, corrected])
        session.flush()
        position = Position(
            id=uuid.uuid4(),
            owner_id=owner.id,
            instrument_id=old.id,
            shares=1,
            cost=1,
            analysis_status="pending",
            created_at=now,
            updated_at=now,
        )
        session.add(position)
        session.flush()

        position.instrument_id = corrected.id
        ledger: dict[str, object] = {"reconciliation": {}}
        _cleanup_orphan_legacy_instruments(session, ledger)
        session.flush()

        assert session.get(Instrument, old.id) is None
        assert session.get(Instrument, corrected.id) is not None
        assert session.get(Position, position.id).instrument_id == corrected.id
        session.rollback()


def test_report_reconciliation_preserves_target_only_report_file(tmp_path, monkeypatch) -> None:
    reports_dir = tmp_path / "reports" / "2026-07-16"
    reports_dir.mkdir(parents=True)
    filename = "2026-07-16/python-only-report.html"
    (tmp_path / "reports" / filename).write_text("<h1>new report</h1>", encoding="utf-8")
    monkeypatch.setattr(import_sqlite, "DATA_DIR", tmp_path)

    now = datetime.now(UTC)
    owner = User(
        id=uuid.uuid4(),
        username=f"migration-report-{uuid.uuid4().hex}",
        password_hash=hash_password("test-only"),
        role="member",
        status="active",
        created_at=now,
        updated_at=now,
    )
    report = Report(
        id=f"python-only-{uuid.uuid4().hex}",
        owner_id=owner.id,
        visibility="private",
        title="Python 新报告",
        topic="迁移后新增",
        type="custom",
        file=filename,
        tags=[],
        highlights=[],
        meta={},
        content_status="ok",
        created_at=now,
        updated_at=now,
    )
    ledger: dict[str, object] = {"reconciliation": {}}
    with SessionLocal() as session:
        session.add(owner)
        session.flush()
        session.add(report)
        _reconcile_report_files(session, ledger)
        assert ledger["reconciliation"] == {"orphan_html": []}
        session.rollback()
