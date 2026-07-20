"""M3 授权隔离测试（方案 §9.4，多用户核心安全）。

核心断言：A 看不到 B 的持仓/自选；共享报告人人可见、私有仅自己。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import (
    Instrument,
    Position,
    Report,
    User,
    UserSession,
    WatchlistItem,
)


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"authz_{uuid.uuid4().hex[:8]}"
    uid = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            User(
                id=uid,
                username=username,
                password_hash=hash_password("pass-1234"),
                role=role,
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    return username, uid


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "pass-1234"},
        headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"},
    )
    return client


@pytest.fixture
def two_users_with_data():
    ua, uida = _mk_user()
    ub, uidb = _mk_user()
    with SessionLocal() as s:
        sym = uuid.uuid4().hex[:6]  # 唯一 canonical_symbol，避开迁移进来的真实证券
        inst = Instrument(
            id=uuid.uuid4(),
            asset_class="equity",
            exchange="SZSE",
            canonical_symbol=sym,
            display_code=f"SZ{sym}",
            name="测试标的",
            market="创业板",
            provider_ids={},
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        s.add(inst)
        s.flush()
        # A 的持仓 + 自选
        s.add(
            Position(
                id=uuid.uuid4(),
                owner_id=uida,
                instrument_id=inst.id,
                shares=100,
                cost=10,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.add(
            WatchlistItem(
                id=uuid.uuid4(),
                owner_id=uida,
                instrument_id=inst.id,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        # A 的私有报告 + 一个共享报告（写真实 HTML 文件，对齐列表按文件存在性过滤）
        from app.services.report_store import write_report_file

        priv_id = f"priv_{uuid.uuid4().hex[:8]}"
        priv_file = f"2026-07-15/{priv_id}.html"
        write_report_file(priv_file, "<html>A私有</html>")
        s.add(
            Report(
                id=priv_id,
                owner_id=uida,
                visibility="private",
                file=priv_file,
                title="A私有",
                topic="t",
                type="custom",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        shared_id = f"shared_{uuid.uuid4().hex[:8]}"
        shared_file = f"2026-07-15/{shared_id}.html"
        write_report_file(shared_file, "<html>共享报告</html>")
        s.add(
            Report(
                id=shared_id,
                owner_id=uida,
                visibility="shared",
                file=shared_file,
                title="共享报告",
                topic="t",
                type="custom",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    yield (ua, uida), (ub, uidb), inst.id, shared_id
    with SessionLocal() as s:
        for uid in (uida, uidb):
            s.execute(delete(Position).where(Position.owner_id == uid))
            s.execute(delete(WatchlistItem).where(WatchlistItem.owner_id == uid))
            s.execute(delete(Report).where(Report.owner_id == uid))
            s.execute(delete(UserSession).where(UserSession.user_id == uid))
            s.execute(delete(User).where(User.id == uid))
        s.execute(delete(Instrument).where(Instrument.id == inst.id))
        s.commit()


def test_a_sees_own_positions_b_sees_none(two_users_with_data):
    (ua, _), (ub, _), _, _ = two_users_with_data
    client_a = _login(ua)
    client_b = _login(ub)
    assert len(client_a.get("/api/v1/positions").json()) == 1
    assert len(client_b.get("/api/v1/positions").json()) == 0  # B 看不到 A 的持仓
    assert len(client_a.get("/api/v1/watchlist").json()) == 1
    assert len(client_b.get("/api/v1/watchlist").json()) == 0


def test_shared_report_visible_to_all_private_not(two_users_with_data):
    (ua, _), (ub, _), _, shared_id = two_users_with_data
    client_a = _login(ua)
    client_b = _login(ub)
    # 注：库中已有迁移进来的其他报告，故只针对本用例创建的报告断言
    a_ids = {r["id"] for r in client_a.get("/api/v1/reports").json()}
    b_ids = {r["id"] for r in client_b.get("/api/v1/reports").json()}
    priv_id = next(r["id"] for r in client_a.get("/api/v1/reports").json() if r["title"] == "A私有")
    assert shared_id in a_ids and priv_id in a_ids  # A 看到自己的私有+共享
    assert shared_id in b_ids  # B 看到共享
    assert priv_id not in b_ids  # B 看不到 A 的私有


def test_b_cannot_get_a_private_report_404(two_users_with_data):
    (ua, _), (ub, _), _, _ = two_users_with_data
    client_a = _login(ua)
    client_b = _login(ub)
    priv = [r for r in client_a.get("/api/v1/reports").json() if r["visibility"] == "private"][0]
    assert client_b.get(f"/api/v1/reports/{priv['id']}").status_code == 404  # 私有→404


def test_superadmin_also_isolated(two_users_with_data):
    """超管无特权：看不到成员 A 的持仓（ADR-010 完全隔离）。"""
    (ua, _), _, _, _ = two_users_with_data
    admin_name, admin_id = _mk_user(role="superadmin")
    try:
        client_admin = _login(admin_name)
        assert len(client_admin.get("/api/v1/positions").json()) == 0  # 超管看不到 A 的持仓
    finally:
        with SessionLocal() as s:
            s.execute(delete(UserSession).where(UserSession.user_id == admin_id))
            s.execute(delete(User).where(User.id == admin_id))
            s.commit()
