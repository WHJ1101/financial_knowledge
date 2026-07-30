"""LLM 工作流 JSON 边界。

Provider 领域对象会携带 datetime/date/Decimal/UUID 等 Python 值。所有进入 Prompt、
Checkpoint 报告和 PostgreSQL JSONB 的数据先经过同一转换，避免各层各自补字段。
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from pydantic import BaseModel
from pydantic_core import to_jsonable_python


class LlmJsonError(ValueError):
    """Model output did not contain one valid JSON object."""


class JsonParser(Protocol):
    def parse_object(self, content: str) -> dict[str, Any]: ...

    def parse_model[ModelT: BaseModel](self, content: str, model: type[ModelT]) -> ModelT: ...


class LlmJsonParser:
    """The single tolerant extraction boundary for model-produced JSON."""

    _FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)

    def parse_object(self, content: str) -> dict[str, Any]:
        text = str(content or "").strip()
        fenced = self._FENCE.search(text)
        if fenced:
            text = fenced.group(1).strip()
        try:
            parsed = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            parsed = self._scan_object(text)
        if not isinstance(parsed, dict):
            raise LlmJsonError("模型返回的 JSON 不是对象")
        return parsed

    @staticmethod
    def _scan_object(text: str) -> Any:
        decoder = json.JSONDecoder()
        for index, character in enumerate(text):
            if character != "{":
                continue
            try:
                parsed, _ = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        raise LlmJsonError("无法解析模型返回的 JSON")

    def parse_model[ModelT: BaseModel](self, content: str, model: type[ModelT]) -> ModelT:
        return model.model_validate(self.parse_object(content))


DEFAULT_JSON_PARSER: JsonParser = LlmJsonParser()


def to_json_safe(value: Any) -> Any:
    return to_jsonable_python(value)


def dumps_json(value: Any) -> str:
    return json.dumps(to_json_safe(value), ensure_ascii=False)


def parse_json_object(content: str, *, parser: JsonParser = DEFAULT_JSON_PARSER) -> dict[str, Any]:
    return parser.parse_object(content)


def parse_json_model[ModelT: BaseModel](
    content: str,
    model: type[ModelT],
    *,
    parser: JsonParser = DEFAULT_JSON_PARSER,
) -> ModelT:
    return parser.parse_model(content, model)
