"""M11.4 持仓/自选分析测试（方案 §14）。

服务层：fake chat 直接注入（monkeypatch make_sync_chat / 行情），验证分析字段写回 + 失败置 failed。
API 层：analyze 端点属主校验（越权 404）+ 未配 key 422 + 入队 202。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.crypto import encrypt_api_key
from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import Instrument, LlmProfile, Position, User, UserSession, WatchlistItem


def _mk_user(role: str = "member") -> tuple[str, uuid.UUID]:
    username = f"an_{uuid.uuid4().hex[:8]}"
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


def _mk_instrument() -> uuid.UUID:
    iid = uuid.uuid4()
    sym = uuid.uuid4().hex[:6]
    with SessionLocal() as s:
        s.add(
            Instrument(
                id=iid,
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
        )
        s.commit()
    return iid


def _login(username: str) -> TestClient:
    client = TestClient(app)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "pass-1234"},
        headers={"X-CSRF-Token": csrf, "Origin": "http://localhost:5173"},
    )
    return client


def _csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("fk_csrf"), "Origin": "http://localhost:5173"}


def _set_llm(uid: uuid.UUID) -> None:
    with SessionLocal() as s:
        s.add(
            LlmProfile(
                id=uuid.uuid4(),
                user_id=uid,
                name="默认模型",
                api_key_ciphertext=encrypt_api_key("sk-test"),
                api_url="https://openrouter.ai/api/v1",
                model="gpt-4o-mini",
                enabled=True,
                is_default=True,
                key_version=1,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()


@pytest.fixture
def member():
    name, uid = _mk_user()
    yield name, uid
    with SessionLocal() as s:
        s.execute(delete(WatchlistItem).where(WatchlistItem.owner_id == uid))
        s.execute(delete(Position).where(Position.owner_id == uid))
        s.execute(delete(LlmProfile).where(LlmProfile.user_id == uid))
        s.execute(delete(UserSession).where(UserSession.user_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_analyze_watchlist_service_writes_fields(member, monkeypatch):
    _, uid = member
    iid = _mk_instrument()
    item_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            WatchlistItem(
                id=item_id,
                owner_id=uid,
                instrument_id=iid,
                status="观察",
                analysis_status="pending",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()

    def fake_make_chat(session, owner_id, purpose, run_id):
        assert purpose == "stock_analysis"
        return lambda system, user: (
            '{"thesis":"卡住光刻胶环节","advice":"订单确认加仓","risk":"替代路线量产","watchSignals":["认证进度"]}'
        )

    monkeypatch.setattr("app.services.analyzer.make_sync_chat", fake_make_chat)
    monkeypatch.setattr("app.services.analyzer._fetch_quote_sync", lambda inst: None)

    from app.services.analyzer import analyze_watchlist_item

    analyze_watchlist_item(str(item_id))

    with SessionLocal() as s:
        row = s.get(WatchlistItem, item_id)
        assert row.analysis_status == "done"
        assert row.thesis == "卡住光刻胶环节"
        assert row.watch_signals == ["认证进度"]
        s.execute(delete(WatchlistItem).where(WatchlistItem.id == item_id))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.commit()


def test_analyze_position_service_failed_on_bad_json(member, monkeypatch):
    _, uid = member
    iid = _mk_instrument()
    pos_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            Position(
                id=pos_id,
                owner_id=uid,
                instrument_id=iid,
                shares=100,
                cost=10,
                analysis_status="pending",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()

    monkeypatch.setattr("app.services.analyzer.make_sync_chat", lambda *a: lambda system, user: "这不是 JSON")
    monkeypatch.setattr("app.services.analyzer._fetch_quote_sync", lambda inst: None)
    monkeypatch.setattr("app.services.analyzer.collect_instrument_evidence", lambda *_args, **_kwargs: {})

    from app.services.analyzer import analyze_position

    analyze_position(str(pos_id))

    with SessionLocal() as s:
        row = s.get(Position, pos_id)
        assert row.analysis_status == "failed"  # JSON 解析失败 → failed
        s.execute(delete(Position).where(Position.id == pos_id))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.commit()


def test_analyze_position_uses_full_evidence_and_writes_structured_detail(member, monkeypatch):
    _, uid = member
    iid = _mk_instrument()
    pos_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            Position(
                id=pos_id,
                owner_id=uid,
                instrument_id=iid,
                shares=100,
                cost=10,
                analysis_status="pending",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()

    evidence = {
        "technical": {"change_20d_pct": -8.5, "ma20": 11.2, "as_of": "2026-07-18"},
        "fundamental": {
            "kind": "fund_profile",
            "scale_billion": 14.45,
            "top_holdings": [{"code": "TSM", "name": "台积电"}],
            "top_holdings_note": "数据源未提供单项权重与明确报告期",
        },
        "macro": {"pmi": {"period": "2026-06", "value": 50.3, "unit": "点"}},
        "sentiment": {"data_gap": "未找到直接信号"},
        "research": {
            "daily_briefings": [{"title": "2026-07-18 每日市场简报"}],
            "data_gaps": ["没有直接关联报告"],
        },
    }

    def fake_make_chat(_session, _owner_id, purpose, _run_id):
        assert purpose == "position_analysis"

        def chat(system, user):
            payload = json.loads(user)
            assert "过去 5/20 日走势" in system
            assert payload["evidence"]["fundamental"]["top_holdings"][0]["name"] == "台积电"
            assert payload["evidence"]["research"]["daily_briefings"][0]["title"] == "2026-07-18 每日市场简报"
            return json.dumps(
                {
                    "action": "持有",
                    "summary": "20日回撤但基本面与宏观暂未恶化，等待趋势修复。",
                    "trend": "截至2026-07-18，20日跌幅8.5%，价格低于MA20。",
                    "fundamentals": "基金规模145.5亿元，股票仓位保持较高水平。",
                    "macro": "2026年6月PMI为50.3点，制造业处于扩张区间。",
                    "theme_news": "已核对2026-07-18每日市场简报，暂无直接关联报告。",
                    "risk": "若20日跌幅继续扩大且PMI跌破50，应重新评估。",
                    "triggers": ["收复MA20后复核加仓条件"],
                    "evidence_used": ["daily_bars 2026-07-18", "2026-07-18 每日市场简报"],
                    "data_gaps": ["缺少持仓权重"],
                },
                ensure_ascii=False,
            )

        return chat

    monkeypatch.setattr("app.services.analyzer.make_sync_chat", fake_make_chat)
    monkeypatch.setattr("app.services.analyzer.collect_instrument_evidence", lambda *_args, **_kwargs: evidence)
    monkeypatch.setattr("app.services.analyzer._fetch_quote_sync", lambda _inst: {"price": 10.5, "changePct": "1.2"})

    from app.services.analyzer import analyze_position

    analyze_position(str(pos_id))

    with SessionLocal() as s:
        row = s.get(Position, pos_id)
        assert row.analysis_status == "done"
        assert row.reason.startswith("【持有】")
        assert row.analysis_detail["trend"].startswith("截至2026-07-18")
        assert "基金规模14.45亿元" in row.analysis_detail["fundamentals"]
        assert "145.5" not in row.analysis_detail["fundamentals"]
        assert "台积电（TSM）" in row.analysis_detail["fundamentals"]
        assert "基金公开持仓：台积电（TSM）" in row.analysis_detail["evidence_used"]
        assert "基金基本面：数据源未提供单项权重与明确报告期" in row.analysis_detail["data_gaps"]
        assert "情绪面：未找到直接信号" in row.analysis_detail["data_gaps"]
        assert "研究简报：没有直接关联报告" in row.analysis_detail["data_gaps"]
        s.execute(delete(Position).where(Position.id == pos_id))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.commit()


def test_analyze_endpoint_requires_key_and_ownership(member):
    name, uid = member
    iid = _mk_instrument()
    other_name, other_uid = _mk_user()
    client = _login(name)
    other = _login(other_name)
    item_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            WatchlistItem(
                id=item_id,
                owner_id=uid,
                instrument_id=iid,
                status="观察",
                analysis_status="pending",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
    # 未配 key → 422
    assert client.post(f"/api/v1/watchlist/{item_id}/analyze", headers=_csrf(client)).status_code == 422
    # 他人触发 → 404（require_owner 先于 key 检查）
    assert other.post(f"/api/v1/watchlist/{item_id}/analyze", headers=_csrf(other)).status_code == 404
    # 配 key 后 → 202（同事务入队）
    _set_llm(uid)
    resp = client.post(f"/api/v1/watchlist/{item_id}/analyze", headers=_csrf(client))
    assert resp.status_code == 202, resp.text
    assert resp.json()["status"] == "analyzing"
    with SessionLocal() as s:
        s.execute(delete(WatchlistItem).where(WatchlistItem.id == item_id))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.execute(delete(UserSession).where(UserSession.user_id == other_uid))
        s.execute(delete(User).where(User.id == other_uid))
        # 清理入队的 procrastinate job（避免 worker 真跑）
        from sqlalchemy import text

        s.execute(text("DELETE FROM procrastinate_jobs WHERE task_name LIKE 'fk:analyze%'"))
        s.commit()


def test_position_analysis_api_returns_reason_and_marks_job_analyzing(member, monkeypatch):
    name, uid = member
    iid = _mk_instrument()
    pos_id = uuid.uuid4()
    with SessionLocal() as s:
        s.add(
            Position(
                id=pos_id,
                owner_id=uid,
                instrument_id=iid,
                shares=100,
                cost=10,
                reason="【持有】等待突破后再加仓",
                risk="跌破成本线止损",
                analysis_status="done",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()

    async def fake_resolve_batch(*_args, **_kwargs):
        return {}

    monkeypatch.setattr("app.services.market.resolve_batch", fake_resolve_batch)
    client = _login(name)
    holding = client.get("/api/v1/portfolio/analysis").json()["holdings"][0]
    assert holding["reason"] == "【持有】等待突破后再加仓"

    _set_llm(uid)
    response = client.post(f"/api/v1/positions/{pos_id}/analyze", headers=_csrf(client))
    assert response.status_code == 202, response.text
    with SessionLocal() as s:
        assert s.get(Position, pos_id).analysis_status == "analyzing"
        from sqlalchemy import text

        s.execute(text("DELETE FROM procrastinate_jobs WHERE task_name = 'fk:analyze_position'"))
        s.execute(delete(Position).where(Position.id == pos_id))
        s.execute(delete(Instrument).where(Instrument.id == iid))
        s.commit()
