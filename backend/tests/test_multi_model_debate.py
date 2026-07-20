"""多 Profile → 八 Agent → LangGraph → Debate 报告的整链路回归。

测试使用真实 PostgreSQL 模型、Fernet 密文、路由解析器和辩论图，
只替换最后的模型网络调用，不访问外部 Provider。
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import delete

from app.core.crypto import encrypt_api_key
from app.core.security import hash_password
from app.db import SessionLocal
from app.llm.context import DEBATE_AGENT_ROLES
from app.models import Debate, Instrument, LlmAgentRoute, LlmProfile, User
from app.services.debate_runner import execute_debate


@pytest.fixture
def fully_routed_debate() -> tuple[str, dict[str, str]]:
    now = datetime.now(UTC)
    user_id = uuid.uuid4()
    instrument_id = uuid.uuid4()
    debate_id = uuid.uuid4().hex[:26]
    expected_keys: dict[str, str] = {}

    with SessionLocal() as session:
        session.add(
            User(
                id=user_id,
                username=f"multi_model_{uuid.uuid4().hex[:8]}",
                password_hash=hash_password("pass-1234"),
                role="member",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            Instrument(
                id=instrument_id,
                asset_class="equity",
                exchange="SZSE",
                canonical_symbol=uuid.uuid4().hex[:6],
                display_code="MMTEST",
                name="多模型路由测试",
                market="创业板",
                provider_ids={},
                source="test",
                active=True,
                created_at=now,
                updated_at=now,
            )
        )
        # 这些模型没有 ORM relationship，先显式落主表，再写带外键的 Profile。
        session.flush()
        profiles: dict[str, LlmProfile] = {}
        for index, role in enumerate(DEBATE_AGENT_ROLES):
            api_key = f"sk-test-{role}-credential"
            expected_keys[role] = api_key
            profile = LlmProfile(
                id=uuid.uuid4(),
                user_id=user_id,
                name=f"{role}-profile",
                api_key_ciphertext=encrypt_api_key(api_key),
                api_url="https://openrouter.ai/api/v1",
                model=f"model-{role}",
                enabled=True,
                is_default=index == 0,
                key_version=1,
                created_at=now,
                updated_at=now,
            )
            profiles[role] = profile
            session.add(profile)
        session.flush()
        session.add_all(
            [
                LlmAgentRoute(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    purpose="debate",
                    role=role,
                    profile_id=profiles[role].id,
                    temperature=index / 10,
                    created_at=now,
                    updated_at=now,
                )
                for index, role in enumerate(DEBATE_AGENT_ROLES)
            ]
        )
        session.add(
            Debate(
                id=debate_id,
                owner_id=user_id,
                execution_owner_id=user_id,
                instrument_id=instrument_id,
                graph_thread_id=f"test:{debate_id}",
                horizon="long",
                question="多模型路由是否正确？",
                status="queued",
                progress=0,
                attempt=0,
                model_assignments={},
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()

    yield debate_id, expected_keys

    with SessionLocal() as session:
        session.execute(delete(Debate).where(Debate.id == debate_id))
        session.execute(delete(Instrument).where(Instrument.id == instrument_id))
        session.execute(delete(User).where(User.id == user_id))
        session.commit()


def _fake_role_result(role: str) -> str:
    if role in {"technical", "fundamental", "macro", "sentiment"}:
        return json.dumps({"stance": "neutral", "points": [f"{role}-point"], "confidence": 60, "data_gaps": []})
    if role in {"bull", "bear"}:
        return json.dumps(
            {"points": [f"{role}-point"], "rebuttal": f"{role}-rebuttal", "confidence": 60, "data_gaps": []}
        )
    if role == "judge":
        return json.dumps(
            {
                "verdict": "中性",
                "confidence": 60,
                "key_disagreements": [],
                "bull_case": "bull",
                "bear_case": "bear",
                "falsifiers": [],
                "action": {"stance": "观望", "trigger": "", "stop_loss": ""},
                "data_caveats": [],
            }
        )
    return json.dumps({"risks": ["route-risk"], "overall": "中性"})


def test_eight_agents_use_their_own_profiles_keys_and_models(
    fully_routed_debate: tuple[str, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    debate_id, expected_keys = fully_routed_debate
    calls: Counter[str] = Counter()
    observed_keys: dict[str, str] = {}

    monkeypatch.setattr("app.llm.client.validate_endpoint", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "app.services.debate_runner.collect_instrument_evidence",
        lambda *_args, **_kwargs: {
            "technical": {"close": 10},
            "fundamental": {"pe": 20},
            "macro": {"series": []},
            "sentiment": {"signals": []},
        },
    )
    monkeypatch.setattr("app.services.debate_runner._checkpoint_context", lambda: nullcontext(None))

    def fake_complete(client: Any, _messages: list[dict[str, str]], _temperature: float | None = None) -> str:
        role = client._config.model.removeprefix("model-")
        calls[role] += 1
        observed_keys[role] = client._config.api_key
        return _fake_role_result(role)

    monkeypatch.setattr("app.llm.client.LangchainChatClient.complete_sync", fake_complete)

    execute_debate(debate_id)

    with SessionLocal() as session:
        debate = session.get(Debate, debate_id)
        assert debate is not None
        assert debate.status == "done"
        assert debate.report is not None
        assignments = debate.model_assignments
        assert set(assignments) == set(DEBATE_AGENT_ROLES)
        assert len({assignment["profile_id"] for assignment in assignments.values()}) == 8
        for index, role in enumerate(DEBATE_AGENT_ROLES):
            assert assignments[role]["model"] == f"model-{role}"
            assert assignments[role]["profile_name"] == f"{role}-profile"
            assert assignments[role]["temperature"] == pytest.approx(index / 10)
        assert debate.report["model_assignments"] == assignments
        serialized = json.dumps(debate.report, ensure_ascii=False)
        assert all(api_key not in serialized for api_key in expected_keys.values())

    assert observed_keys == expected_keys
    assert calls == Counter(
        {
            "technical": 1,
            "fundamental": 1,
            "macro": 1,
            "sentiment": 1,
            "bull": 2,
            "bear": 2,
            "judge": 1,
            "risk": 1,
        }
    )
