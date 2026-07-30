"""M11.2 报告落盘 / 生命周期测试（方案 §14）。

report_store：文件路径构造 + 路径穿越防护 + 读写。
report_lifecycle：研究创建/导入的 DB+HTML+日志落地、类型推断、自动化去重覆盖。
用临时 data_dir（settings.data_dir），DB 用 dev postgres。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete

from app.config import get_settings
from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Log, Report, User
from app.services import report_store
from app.services.report_lifecycle import create_daily_briefing_report, create_report, import_report


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path), raising=False)
    return tmp_path


@pytest.fixture
def owner():
    uid = uuid.uuid4()
    username = f"rep_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        s.add(
            User(
                id=uid,
                username=username,
                password_hash=hash_password("x"),
                role="member",
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        s.commit()
        yield s.get(User, uid)
        s.execute(delete(Report).where(Report.owner_id == uid))
        s.execute(delete(User).where(User.id == uid))
        s.commit()


def test_build_report_file():
    assert report_store.build_report_file("2026-07-15", "abc") == "2026-07-15/abc.html"


def test_resolve_rejects_path_traversal(tmp_data_dir):
    with pytest.raises(ValueError):
        report_store.resolve_report_path("../../etc/passwd")
    with pytest.raises(ValueError):
        report_store.resolve_report_path("../outside.html")


def test_write_and_read_report_file(tmp_data_dir):
    report_store.write_report_file("2026-07-15/t.html", "<html>hi</html>")
    assert report_store.report_file_exists("2026-07-15/t.html") is True
    assert report_store.read_report_file("2026-07-15/t.html") == "<html>hi</html>"
    assert report_store.delete_report_file("2026-07-15/t.html") is True
    assert report_store.report_file_exists("2026-07-15/t.html") is False


def test_create_report_writes_db_html_log(tmp_data_dir, owner):
    brief = {
        "summary": "测试摘要",
        "highlights": ["要点1"],
        "watchList": ["跟踪1"],
        "risks": ["风险1"],
        "nextSteps": ["下一步1"],
        "tags": ["半导体"],
        "evidence": [{"title": "证据A", "source": "本地", "excerpt": "内容"}],
        "dataQuality": [{"name": "模型深度分析", "status": "正常 · gpt"}],
    }
    with SessionLocal() as s:
        user = s.get(User, owner.id)
        report = create_report(s, user, "半导体设备", "industry", brief, source="page")
        rid, file = report.id, report.file
    # DB 落地
    with SessionLocal() as s:
        row = s.get(Report, rid)
        assert row is not None
        assert row.type == "industry"
        assert row.type_label == "产业链深度"
        assert row.visibility == "private"
        assert row.summary == "测试摘要"
    # HTML 落地 + 内容含摘要/证据
    html = report_store.read_report_file(file)
    assert html is not None
    assert "测试摘要" in html
    assert "证据A" in html
    assert "半导体设备" in html
    # 日志落地
    with SessionLocal() as s:
        logs = s.query(Log).filter(Log.type == "research").all()
        assert any(rid == (lg.log_metadata or {}).get("id") for lg in logs)
        s.execute(delete(Log).where(Log.type == "research"))
        s.commit()


def test_import_report_infers_type_and_wraps_html(tmp_data_dir, owner):
    with SessionLocal() as s:
        user = s.get(User, owner.id)
        report = import_report(
            s,
            user,
            {
                "title": "工信部发布新政策",
                "topic": "工信部发布新政策",
                "content": "正文明文内容",
                "tags": ["政策"],
            },
        )
        rid, file, rtype = report.id, report.file, report.type
        metadata = report.meta
    assert rtype == "policy"  # inferType 命中「工信部」
    html = report_store.read_report_file(file)
    assert html is not None
    assert "正文明文内容" in html
    assert "Content-Security-Policy" in html
    assert metadata["import_source"] == "chat"
    assert metadata["import_visibility"] == "private"
    assert metadata["imported_at"]
    assert metadata["sanitization"] == {"policy": "report-html-v1", "stored": "sanitized"}
    with SessionLocal() as s:
        s.execute(delete(Log).where(Log.type == "report_import"))
        s.execute(delete(Report).where(Report.id == rid))
        s.commit()


def test_daily_briefing_is_shared_and_rerun_repairs_visibility(tmp_data_dir, owner):
    now = datetime(2040, 1, 2, 8, tzinfo=UTC)
    brief = {
        "summary": "日更摘要",
        "highlights": ["要点"],
        "tags": ["日更"],
        "dataQuality": [],
    }
    with SessionLocal() as s:
        user = s.get(User, owner.id)
        first = create_daily_briefing_report(s, user, brief, now, source="scheduled")
        report_id = first.id
        assert first.visibility == "shared"
        first.visibility = "private"
        s.commit()

        second = create_daily_briefing_report(s, user, brief, now, source="scheduled")
        assert second.id == report_id
        assert second.visibility == "shared"

        s.execute(delete(Log).where(Log.type == "daily_market_briefing"))
        s.commit()
