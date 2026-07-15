"""M8 端到端：用真实 LLM（OpenRouter，读根 .env）跑一次完整辩论。

一次性验证脚本：构造 chat client → 跑 LangGraph 图 → 打印报告结构。
不落库、不依赖测试用户，纯验证真实模型能产出完整报告。
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

# 读根 .env 的 LLM 配置（FINANCE_KNOWLEDGE_LLM_*）
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
for line in ROOT_ENV.read_text().splitlines():
    if line.startswith("FINANCE_KNOWLEDGE_LLM_") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v)

from app.agents.decision.graph import run_debate_graph  # noqa: E402
from app.llm.client import LangchainChatClient  # noqa: E402
from app.llm.context import ResolvedLlmConfig  # noqa: E402
from app.providers.eastmoney_macro import latest_macro_snapshot  # noqa: E402


def main() -> int:
    import anyio

    api_url = os.environ["FINANCE_KNOWLEDGE_LLM_API_URL"]
    config = ResolvedLlmConfig(
        api_key=os.environ["FINANCE_KNOWLEDGE_LLM_API_KEY"],
        api_url=api_url,
        model=os.environ.get("FINANCE_KNOWLEDGE_LLM_MODEL", "openai/gpt-4o-mini"),
    )
    client = LangchainChatClient(config)

    def chat(system: str, user: str) -> str:
        return client.complete_sync([{"role": "system", "content": system},
                                     {"role": "user", "content": user}])

    # 宏观面用东财 datacenter 真实数据（CPI/PPI/PMI/GDP/M2，带 as_of 时点口径）
    macro = anyio.run(latest_macro_snapshot, datetime.now(UTC))
    print(f"=== 真实宏观数据（东财 datacenter）===\n{json.dumps(macro, ensure_ascii=False)}\n")

    target = {"instrument_id": "e2e", "code": "301308", "name": "江波龙", "market": "创业板"}
    evidence = {
        "technical": {"ma_short": 46.1, "ma_long": 42.3, "chg5d": 3.2, "chg20d": 12.5, "volume_ratio": 1.4},
        "fundamental": {"pe": 143.0, "pb": 18.55, "roe": 39.4, "profit_yoy": 2644, "revenue_yoy": 132.8},
        "macro": macro,  # ★真实宏观
        "sentiment": {"signals": ["存储涨价预期", "AI 需求拉动"], "recent_chg": 3.2},
    }

    print(f"=== 真实辩论 · {config.model} @ {api_url} ===")
    report = run_debate_graph(chat, target, evidence)

    judge = report.get("judge") or {}
    print(f"\n目标: {report['target']['name']}")
    print(f"裁判结论: {judge.get('verdict')} (置信度 {judge.get('confidence')})")
    print(f"分析师: {list(report['analysts'].keys())}")
    print(f"宏观分析师观点: {report['analysts'].get('macro', {}).get('points')}")
    print(f"数据缺口: {report['data_gaps']}")
    print(f"证伪条件: {judge.get('falsifiers')}")
    print(f"操作建议: {judge.get('action')}")
    print(f"风险: {(report.get('risk_review') or {}).get('risks')}")

    # 结构完整性断言
    assert report["target"], "缺 target"
    assert set(report["analysts"].keys()) == {"technical", "fundamental", "macro", "sentiment"}
    assert judge.get("verdict") in ("偏多", "偏空", "中性"), f"verdict 非法: {judge.get('verdict')}"
    assert "非投资建议" in report["disclaimer"]
    print("\n✓ 端到端通过：真实模型 + 真实宏观数据，产出结构完整的辩论报告")

    # 存一份样例供人工查看
    out = Path(__file__).resolve().parents[1] / "e2e_debate_sample.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"样例报告已存: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
