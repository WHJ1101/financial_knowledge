"""报告↔证券关联 API（方案 §3.4/§11.3）。

GET  /reports/{id}/assets      —— 报告的关联资产（报告可见即可读）
POST /reports/{id}/assets      —— 手动建链（仅报告 owner=self）
DELETE /report-asset-links/{id} —— 删关联（仅所属报告 owner=self）
GET  /assets/{code}/reports    —— 证券被关联的报告（只返查看者可见的报告）
写操作过 CSRF；关联增删写审计日志。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf
from app.core.authz import require_owner
from app.db import get_session
from app.models import Report, ReportAssetLink, User
from app.services.logs import append_log
from app.services.report_assets import (
    delete_report_asset_link,
    get_asset_report_links,
    get_report_asset_links,
    upsert_report_asset_link,
)

router = APIRouter(prefix="/api/v1", tags=["report-assets"])


class AssetLinkRequest(BaseModel):
    assetCode: str = Field(min_length=1, max_length=32)
    assetName: str | None = None
    assetMarket: str | None = None
    relation: str = Field(default="related", max_length=32)


def _visible_report_or_404(session: Session, report_id: str, user: User) -> Report:
    report = session.get(Report, report_id)
    if report is None or (report.visibility != "shared" and report.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Not Found")
    return report


@router.get("/reports/{report_id}/assets")
def list_report_assets(
    report_id: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    _visible_report_or_404(session, report_id, user)
    return {"assets": get_report_asset_links(session, report_id)}


@router.post("/reports/{report_id}/assets", dependencies=[Depends(require_csrf)])
def add_report_asset(
    report_id: str,
    body: AssetLinkRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    # 改关联需报告属主（非属主/不存在 → 404，方案 §3.4）
    report = session.get(Report, report_id)
    require_owner(report.owner_id if report else None, user.id)
    try:
        link = upsert_report_asset_link(session, report_id, body.model_dump())
    except (ValueError, LookupError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    append_log(
        session,
        "report_asset_link",
        f"Saved report asset link: {report_id} -> {body.assetCode}",
        {"reportId": report_id, "assetCode": body.assetCode, "relation": link["relation"], "source": link["source"]},
    )
    session.commit()
    return {"asset": link}


@router.delete("/report-asset-links/{link_id}", dependencies=[Depends(require_csrf)])
def remove_report_asset_link(
    link_id: uuid.UUID, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    # 校验所属报告属主（非属主/不存在 → 404）
    link = session.get(ReportAssetLink, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Not Found")
    report = session.get(Report, link.report_id)
    require_owner(report.owner_id if report else None, user.id)
    report_id = link.report_id
    deleted, _ = delete_report_asset_link(session, link_id)
    if deleted:
        append_log(
            session,
            "report_asset_link",
            f"Deleted report asset link: {link_id}",
            {"id": str(link_id), "reportId": report_id},
        )
    session.commit()
    return {"deleted": deleted}


@router.get("/assets/{code}/reports")
def list_asset_reports(
    code: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> dict[str, Any]:
    return {"reports": get_asset_report_links(session, code, user.id)}
