"""导出 API（方案 §11.8）。按 owner 隔离持仓、按 shared|owner 过滤报告（不再全局导出）。

GET /export/{positions,reports}.{csv,json}：CSV UTF-8（带 BOM 便于 Excel）/ JSON。
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db import get_session
from app.models import Instrument, Position, Report, User

router = APIRouter(prefix="/api/v1", tags=["export"])

_POSITION_COLUMNS = [
    ("code", "代码"),
    ("name", "名称"),
    ("market", "市场"),
    ("shares", "数量"),
    ("cost", "成本价"),
    ("reason", "持仓理由"),
    ("risk", "风险"),
    ("updatedAt", "更新时间"),
]
_REPORT_COLUMNS = [
    ("id", "ID"),
    ("title", "标题"),
    ("topic", "主题"),
    ("typeLabel", "类型"),
    ("summary", "摘要"),
    ("tags", "标签"),
    ("visibility", "可见性"),
    ("source", "来源"),
    ("origin", "产出方式"),
    ("localDate", "日期"),
    ("createdAt", "创建时间"),
    ("updatedAt", "更新时间"),
]


def _position_rows(session: Session, user: User) -> list[dict[str, Any]]:
    rows = session.execute(
        select(Position, Instrument)
        .join(Instrument, Position.instrument_id == Instrument.id)
        .where(Position.owner_id == user.id)
        .order_by(Position.updated_at.desc())
    ).all()
    return [
        {
            "code": inst.display_code,
            "name": inst.name,
            "market": inst.market,
            "shares": float(pos.shares or 0),
            "cost": float(pos.cost or 0),
            "reason": pos.reason or "",
            "risk": pos.risk or "",
            "updatedAt": pos.updated_at.isoformat() if pos.updated_at else "",
        }
        for pos, inst in rows
    ]


def _report_rows(session: Session, user: User) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            select(Report)
            .where(or_(Report.visibility == "shared", Report.owner_id == user.id))
            .order_by(Report.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "title": r.title,
            "topic": r.topic,
            "typeLabel": r.type_label or "",
            "summary": r.summary or "",
            "tags": "、".join(str(t) for t in (r.tags or [])),
            "visibility": r.visibility,
            "source": r.source or "",
            "origin": r.origin or "",
            "localDate": r.local_date or "",
            "createdAt": r.created_at.isoformat() if r.created_at else "",
            "updatedAt": r.updated_at.isoformat() if r.updated_at else "",
        }
        for r in rows
    ]


def _to_csv(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for _, label in columns])
    for row in rows:
        writer.writerow([row.get(key, "") for key, _ in columns])
    return buf.getvalue()


@router.get("/export/{name}.{fmt}")
def export(
    name: str, fmt: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> Response:
    if name == "positions":
        rows, columns = _position_rows(session, user), _POSITION_COLUMNS
    elif name == "reports":
        rows, columns = _report_rows(session, user), _REPORT_COLUMNS
    else:
        raise HTTPException(status_code=404, detail="Unsupported export kind")

    if fmt == "json":
        body = json.dumps({name: rows}, ensure_ascii=False, indent=2)
        media = "application/json; charset=utf-8"
    elif fmt == "csv":
        body = "﻿" + _to_csv(rows, columns)  # BOM 便于 Excel 识别 UTF-8
        media = "text/csv; charset=utf-8"
    else:
        raise HTTPException(status_code=404, detail="Unsupported export format")
    return Response(
        content=body,
        media_type=media,
        headers={"content-disposition": f'attachment; filename="{name}.{fmt}"', "cache-control": "no-store"},
    )
