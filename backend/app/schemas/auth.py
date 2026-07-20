"""认证相关 Pydantic 出入参（方案 §9）。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    invite_code: str = Field(min_length=1)
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class UserView(BaseModel):
    username: str
    role: str
    status: str


class SessionView(BaseModel):
    authenticated: bool
    user: UserView | None = None


class InviteCreateRequest(BaseModel):
    ttl_hours: int = Field(default=72, ge=1, le=720)
    hint: str = Field(default="", max_length=32)


class InviteView(BaseModel):
    id: str
    code: str | None = None  # 仅生成时返回一次明文
    code_hint: str
    expires_at: datetime
    used_by: str | None = None
    used_at: datetime | None = None
    revoked_at: datetime | None = None


class CsrfView(BaseModel):
    csrf_token: str
