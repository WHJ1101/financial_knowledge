"""报告 HTML 落盘（移植 server/services/report-file-store.js，方案 §11.2/§11.3）。

report file 相对路径固定 <local_day>/<id>.html，落在 <data_dir>/reports 下。
resolve 时做路径穿越防护（realpath 必须在 REPORT_DIR 内）。
"""

from __future__ import annotations

from pathlib import Path

from app.config import get_settings


def report_root() -> Path:
    return (Path(get_settings().data_dir) / "reports").resolve()


def build_report_file(local_day: str, report_id: str) -> str:
    return f"{local_day}/{report_id}.html"


def resolve_report_path(file: str) -> Path:
    """把相对 file 解析为绝对路径，拒绝越出 REPORT_DIR（路径穿越防护）。"""
    base = report_root()
    target = (base / (file or "")).resolve()
    if target != base and base in target.parents:
        return target
    raise ValueError("Forbidden report path")


def write_report_file(file: str, html: str) -> None:
    target = resolve_report_path(file)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, "utf-8")


def report_file_exists(file: str | None) -> bool:
    if not file:
        return False
    try:
        return resolve_report_path(file).is_file()
    except ValueError:
        return False


def delete_report_file(file: str | None) -> bool:
    if not file:
        return False
    try:
        target = resolve_report_path(file)
    except ValueError:
        return False
    if not target.is_file():
        return False
    target.unlink()
    return True


def read_report_file(file: str | None) -> str | None:
    if not file:
        return None
    try:
        target = resolve_report_path(file)
    except ValueError:
        return None
    if not target.is_file():
        return None
    return target.read_text("utf-8")
