"""LLM 工作流 JSON 边界。

Provider 领域对象会携带 datetime/date/Decimal/UUID 等 Python 值。所有进入 Prompt、
Checkpoint 报告和 PostgreSQL JSONB 的数据先经过同一转换，避免各层各自补字段。
"""

from __future__ import annotations

import json
from typing import Any

from pydantic_core import to_jsonable_python


def to_json_safe(value: Any) -> Any:
    return to_jsonable_python(value)


def dumps_json(value: Any) -> str:
    return json.dumps(to_json_safe(value), ensure_ascii=False)
