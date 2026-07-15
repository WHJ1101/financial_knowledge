"""授权：属主校验（方案 §9.4）。

隔离资源读写校验 owner_id==current_user；无权返回 404（不泄露存在性）。
超管无特权：对他人隔离资源同样 404（完全隔离，ADR-010）。
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException


def require_owner(resource_owner_id: uuid.UUID | None, current_user_id: uuid.UUID) -> None:
    """校验属主。非属主（含超管）→ 404。"""
    if resource_owner_id is None or resource_owner_id != current_user_id:
        raise HTTPException(status_code=404, detail="Not Found")
