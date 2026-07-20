"""对一个已创建的 Debate 执行真实 worker 闭环。

用法：先在页面发起辩论并暂停 worker，随后执行：
``python -m scripts.e2e_debate <debate_id>``。
脚本读取数据库中的逐用户多 Profile/Agent 路由，经过真实证据采集、LangGraph checkpoint、
结果落库和终态校验；不读取已废弃的全局 LLM 环境变量。
"""

from __future__ import annotations

import argparse
import json

from app.db import SessionLocal
from app.models import Debate
from app.services.debate_runner import execute_debate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("debate_id", help="页面/API 已创建且属于 queued/failed 的 Debate ID")
    args = parser.parse_args()

    with SessionLocal() as session:
        debate = session.get(Debate, args.debate_id)
        if debate is None:
            raise SystemExit(f"Debate 不存在: {args.debate_id}")
        if debate.status in ("done", "canceled"):
            raise SystemExit(f"Debate 已是终态: {debate.status}")

    execute_debate(args.debate_id)

    with SessionLocal() as session:
        debate = session.get(Debate, args.debate_id)
        assert debate is not None
        summary = {
            "id": debate.id,
            "status": debate.status,
            "attempt": debate.attempt,
            "verdict": debate.verdict,
            "confidence": debate.confidence,
            "models": debate.model_assignments,
            "error_code": debate.error_code,
            "error_message": debate.error_message,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
        if debate.status != "done" or not debate.report:
            raise SystemExit("端到端失败：任务未进入 done 或报告为空")
        required = {"target", "analysts", "debate", "judge", "risk_review", "model_assignments"}
        missing = sorted(required - set(debate.report))
        if missing:
            raise SystemExit(f"端到端失败：报告缺字段 {missing}")
    print("✓ 真实多模型辩论闭环通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
