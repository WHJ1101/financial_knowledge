"""M11.2 研究流水线纯函数测试（方案 §13/§14）。

覆盖：主题匹配/标签派生、证据规整/去重、LLM JSON 解析（含代码围栏/噪声）、
LLM brief 规整、证据草稿降级、数据质量。不打真实 LLM/网络。
"""

from __future__ import annotations

from app.services.research import (
    Evidence,
    build_evidence_draft,
    dedupe_evidence,
    derive_tags,
    expand_records,
    filter_matching,
    matches_terms,
    merge_tags,
    normalize_llm_brief,
    normalize_record,
    parse_llm_json,
    run_research_pipeline,
    topic_terms,
)


def test_derive_and_merge_tags():
    tags = derive_tags("AI算力与光模块产业链", "industry")
    assert "产业链" in tags  # type fallback
    assert "AI" in tags and "算力" in tags and "光模块" in tags
    assert merge_tags(["A", "A", ""], ["B"]) == ["A", "B"]  # 去重去空


def test_topic_terms_and_matching():
    terms = topic_terms("半导体设备", "industry")
    assert "industry" in terms
    assert "半导体设备" in terms
    assert matches_terms("这是半导体设备行业", terms) is True
    assert matches_terms("完全无关内容", ["industry"]) is False


def test_expand_and_normalize_record():
    assert expand_records([1, 2]) == [1, 2]
    assert expand_records({"items": [1]}) == [1]
    assert expand_records({"a": 1}) == [{"a": 1}]
    ev = normalize_record({"title": "标题", "summary": "摘要", "url": "http://x", "date": "2026-07-10"}, "本地", "兜底")
    assert ev.title == "标题"
    assert ev.excerpt == "摘要"
    assert ev.url == "http://x"
    assert ev.observed_at == "2026-07-10"


def test_dedupe_evidence():
    a = Evidence(source="s", title="t", observed_at="2026-07-10")
    b = Evidence(source="s", title="t", observed_at="2026-07-10")  # 同键
    c = Evidence(source="s", title="t2", observed_at="2026-07-10")
    assert len(dedupe_evidence([a, b, c])) == 2


def test_filter_matching_falls_back_to_all():
    records = [Evidence(source="s", title="无关A"), Evidence(source="s", title="无关B")]
    # 无命中 → 返回全部（不空）
    assert len(filter_matching(records, "半导体", "industry")) == 2


def test_parse_llm_json_variants():
    assert parse_llm_json('{"summary": "x"}')["summary"] == "x"
    assert parse_llm_json('```json\n{"summary": "y"}\n```')["summary"] == "y"
    assert parse_llm_json('前缀噪声 {"summary": "z"} 后缀')["summary"] == "z"


def test_parse_llm_json_invalid_raises():
    import pytest

    with pytest.raises(ValueError):
        parse_llm_json("不是 JSON")


def test_normalize_llm_brief_fills_defaults():
    brief = normalize_llm_brief({"summary": "s", "highlights": ["h1"]}, [Evidence(source="x", title="t")])
    assert brief.summary == "s"
    assert brief.highlights == ["h1"]
    # 缺失字段补默认（含证据数）
    assert brief.watch_list and "待补充" in brief.watch_list[0]


def test_build_evidence_draft_no_llm():
    draft = build_evidence_draft("半导体", "industry", [], "配置模型密钥后启用。")
    assert "半导体" in draft.summary
    assert len(draft.highlights) == 3
    assert "产业链" in draft.tags


def test_pipeline_without_chat_degrades():
    brief = run_research_pipeline(
        None, "AI算力", "industry", "/nonexistent", [], generated_at="2026-07-15T00:00:00Z", model=""
    )
    assert brief.summary
    assert "AI" in brief.tags
    # data_quality 模型项应为待配置
    model_q = next(q for q in brief.data_quality if q["name"] == "模型深度分析")
    assert "待配置" in model_q["status"]


def test_pipeline_with_fake_chat():
    def fake_chat(system: str, user: str) -> str:
        assert "研究" in system or "JSON" in system
        return '{"summary": "算力景气度上行", "highlights": ["订单饱满"], "tags": ["算力"]}'

    brief = run_research_pipeline(
        fake_chat, "AI算力", "industry", "/nonexistent", [], generated_at="2026-07-15T00:00:00Z", model="gpt-4o-mini"
    )
    assert brief.summary == "算力景气度上行"
    assert "订单饱满" in brief.highlights
    model_q = next(q for q in brief.data_quality if q["name"] == "模型深度分析")
    assert "正常" in model_q["status"]


def test_pipeline_with_bad_json_degrades():
    def bad_chat(system: str, user: str) -> str:
        return "这不是 JSON，模型跑偏了"

    brief = run_research_pipeline(
        bad_chat, "AI算力", "industry", "/nonexistent", [], generated_at="2026-07-15T00:00:00Z", model="gpt-4o-mini"
    )
    model_q = next(q for q in brief.data_quality if q["name"] == "模型深度分析")
    assert "失败" in model_q["status"]
    assert brief.summary  # 降级草稿仍有内容
