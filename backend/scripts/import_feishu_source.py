"""抓取飞书 Wiki/Docx 社群信号源并写入 data/sources。"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from app.config import get_settings
from app.providers.feishu import fetch_signal_source, parse_feishu_resource


def main() -> int:
    input_url = next((arg for arg in sys.argv[1:] if not arg.startswith("-")), "")
    input_url = input_url or os.environ.get("FEISHU_SIGNAL_WIKI_URL", "") or os.environ.get("FEISHU_SIGNAL_URL", "")
    if not input_url:
        raise SystemExit("请传入飞书 Wiki/Docx 链接，或设置 FEISHU_SIGNAL_WIKI_URL")
    result = asyncio.run(fetch_signal_source(input_url))
    resource = parse_feishu_resource(input_url)
    days = result.get("days") or []
    latest_date = max((str(item.get("date") or "") for item in days), default="unknown")
    output_dir = Path(get_settings().data_dir).resolve() / "sources"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"feishu-signals-{latest_date}-{resource['token'][:12]}.json"
    payload = {
        "provider": "feishu",
        "source_url": input_url,
        "title": result.get("title"),
        "days": days,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已导入飞书信号源：{result.get('title')}")
    print(f"输出文件：{output}")
    print(f"天数：{len(days)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
