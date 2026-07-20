"""M11.5/M11.10 社群信号 + 飞书 纯函数测试（方案 §14）。

社群信号：评分/推断/规整/去重/规则抽取/LLM 抽取（fake chat）。
飞书：webhook 签名、卡片构造、资源解析、按天切分、通道选择（不打真实接口）。
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.providers.community_signal import (
    extract_community_signals,
    fallback_extract_signals,
    infer_signal_type,
    infer_theme,
    normalize_signals,
    score_signal_text,
)
from app.providers.feishu import (
    build_crossing_card,
    build_daily_card,
    build_signal_days,
    parse_feishu_resource,
    split_content_by_day,
)

_NOW = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)


# ---- 社群信号 ----


def test_score_and_infer():
    assert score_signal_text("光模块订单超预期，产能紧缺") > score_signal_text("今天天气不错")
    assert infer_theme("算力服务器需求旺盛") == "AI基础设施"
    assert infer_theme("光伏储能装机") == "新能源"
    assert infer_signal_type("客户下了大额订单") == "订单/招标"
    assert infer_signal_type("产品报价上调") == "价格"


def test_normalize_signals_dedupe_and_fields():
    items = [
        {"theme": "半导体", "summary": "HBM 紧缺", "evidence": "原厂扩产不及预期", "importance": 4},
        {"theme": "半导体", "summary": "HBM 紧缺", "evidence": "原厂扩产不及预期", "importance": 4},  # 重复
    ]
    signals = normalize_signals(items, "2026-07-14", "飞书源", "http://x", "feishu", _NOW)
    assert len(signals) == 1
    s = signals[0]
    assert s["date"] == "2026-07-14"
    assert s["source"] == "feishu"
    assert s["id"].startswith("signal-")
    assert s["importance"] == 4
    assert s["expiresAt"] > s["observedAt"]  # 时效锚定该日 + TTL


def test_fallback_extract_from_text():
    text = (
        "光模块龙头订单饱满，Q3 交付超预期，产能紧缺。\n\n"
        "某券商上调半导体设备板块评级，国产替代加速。\n\n"
        "闲聊：今天午饭吃什么。"
    )
    signals = fallback_extract_signals(text, "2026-07-14", "源", "", "feishu", _NOW)
    assert len(signals) >= 1
    # 高价值线索应被抽出，闲聊（score 0）被过滤
    assert all("午饭" not in s["summary"] for s in signals)


def test_extract_with_fake_chat():
    def chat(system: str, user: str) -> str:
        assert "抽取" in system or "JSON" in system
        return '{"items": [{"theme": "AI基础设施", "summary": "算力景气", "evidence": "e", "importance": 5}]}'

    result = extract_community_signals(chat, "算力需求旺盛，机构调研密集", "2026-07-14", "源", "http://x", now=_NOW)
    assert result["method"] == "llm"
    assert result["signals"][0]["theme"] == "AI基础设施"


def test_extract_bad_json_falls_back():
    result = extract_community_signals(
        lambda s, u: "非 JSON", "光模块订单超预期产能紧缺一线反馈", "2026-07-14", "源", "", now=_NOW
    )
    assert result["method"] == "fallback"
    assert "失败" in result["error"]


def test_extract_empty_text():
    result = extract_community_signals(None, "   ", "2026-07-14", "源", "", now=_NOW)
    assert result["method"] == "empty"


# ---- 飞书 ----


def test_parse_feishu_resource():
    assert parse_feishu_resource("https://x.feishu.cn/wiki/ABC123?a=1") == {"kind": "wiki", "token": "ABC123"}
    assert parse_feishu_resource("https://x.feishu.cn/docx/DEF456") == {"kind": "docx", "token": "DEF456"}
    assert parse_feishu_resource("RAWTOKEN") == {"kind": "wiki", "token": "RAWTOKEN"}


def test_split_content_by_day():
    content = "文档标题（忽略）\n2026-07-14 · 群名\n光模块订单超预期\ndigest-1.png\n2026-07-15\n半导体扩产"
    days = split_content_by_day(content)
    assert len(days) == 2
    assert days[0]["date"] == "2026-07-14"
    assert "光模块订单超预期" in days[0]["content"]
    assert "digest-1.png" not in days[0]["content"]  # 附件行剔除
    assert days[1]["date"] == "2026-07-15"


def test_build_signal_days_fallback_when_no_heading():
    days = build_signal_days("没有天级标题的整段内容", "标题", "2026-07-15")
    assert len(days) == 1
    assert days[0]["date"] == "2026-07-15"


def test_build_daily_card():
    card = build_daily_card(
        [
            {"name": "A股半导体", "market": "A股", "composite": 75, "status": "放量下跌", "subScores": []},
        ]
    )
    assert card["header"]["template"] == "blue"
    assert any("📊" in str(card["header"]["title"]["content"]) for _ in [0])


def test_build_crossing_card_up():
    card = build_crossing_card(
        [
            {
                "name": "A股半导体",
                "market": "A股",
                "composite": 72,
                "status": "上穿",
                "crossing": "up-70",
                "subScores": [],
            },
        ]
    )
    assert card["header"]["template"] == "red"
