from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import text

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Debate, Instrument, User
from app.queue import procrastinate_app
from scripts.repair_migrated_data import _repair_debate_queue


def test_repair_debate_queue_removes_orphans_and_links_namespaced_job() -> None:
    now = datetime.now(UTC)
    owner = User(
        id=uuid.uuid4(),
        username=f"queue-repair-{uuid.uuid4().hex}",
        password_hash=hash_password("test-only"),
        role="member",
        status="active",
        created_at=now,
        updated_at=now,
    )
    instrument = Instrument(
        id=uuid.uuid4(),
        asset_class="equity",
        exchange="SSE",
        canonical_symbol="600000",
        display_code="600000",
        name="队列测试",
        market="沪市主板",
        provider_ids={},
        source="test",
        active=True,
        created_at=now,
        updated_at=now,
    )
    debate_id = f"Q{uuid.uuid4().hex[:25]}"
    debate = Debate(
        id=debate_id,
        owner_id=owner.id,
        execution_owner_id=owner.id,
        instrument_id=instrument.id,
        graph_thread_id=f"test-{uuid.uuid4()}",
        horizon="swing",
        model_assignments={},
        status="queued",
        progress=0,
        attempt=0,
        created_at=now,
        updated_at=now,
    )
    with SessionLocal() as session:
        session.execute(text("DELETE FROM procrastinate_events"))
        session.execute(text("DELETE FROM procrastinate_jobs"))
        session.add_all([owner, instrument])
        session.flush()
        session.add(debate)
        session.flush()
        task = procrastinate_app.tasks["fk:run_debate"]
        valid_job_id = task.configure(connection=session.connection()).defer(debate_id=debate_id)
        orphan_job_id = task.configure(connection=session.connection()).defer(debate_id="missing-debate")
        session.execute(
            text("UPDATE procrastinate_jobs SET task_name='run_debate' WHERE id=:job_id"),
            {"job_id": valid_job_id},
        )

        summary = _repair_debate_queue(session)
        session.flush()

        assert summary["jobs_removed"] == [orphan_job_id]
        assert summary["legacy_task_names_updated"] == [valid_job_id]
        assert summary["active_debates_linked"] == {debate_id: valid_job_id}
        assert debate.queue_job_id == valid_job_id
        assert (
            session.execute(
                text("SELECT task_name FROM procrastinate_jobs WHERE id=:job_id"),
                {"job_id": valid_job_id},
            ).scalar_one()
            == "fk:run_debate"
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM procrastinate_jobs WHERE id=:job_id"),
                {"job_id": orphan_job_id},
            ).scalar_one()
            == 0
        )
        session.rollback()
