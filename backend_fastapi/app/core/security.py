from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt import InvalidTokenError

from app.core.config import settings
from app.db import get_platform_admin_settings, get_user_by_id


def create_access_token(
    user_id: str,
    role: str,
    *,
    mfa_verified: bool = False,
    token_purpose: str = "access",
    expires_minutes: int | None = None,
) -> str:
    issued_at = datetime.now(timezone.utc)
    if expires_minutes is None:
        platform_settings = get_platform_admin_settings()
        expiration = platform_settings.get("jwt_expiration_minutes", settings.jwt_access_token_expire_minutes)
        expires_minutes = expiration if isinstance(expiration, int) and not isinstance(expiration, bool) and expiration > 0 else settings.jwt_access_token_expire_minutes
    expires_at = issued_at + timedelta(minutes=expires_minutes)
    return jwt.encode(
        {
            "sub": user_id,
            "role": role,
            "iat": issued_at,
            "exp": expires_at,
            "token_purpose": token_purpose,
            "mfa_verified": mfa_verified,
        },
        settings.jwt_secret_key,
        algorithm="HS256",
    )


def _decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "role"]},
        )
    except (InvalidTokenError, TypeError):
        return None


def _user_from_claims(claims: dict[str, Any]) -> dict[str, Any] | None:
    user_id = claims.get("sub")
    role = claims.get("role")
    if not isinstance(user_id, str) or role not in {"student", "instructor", "admin"}:
        return None

    user = get_user_by_id(user_id)
    if user is None or user.get("role") != role or user.get("status") != "active":
        return None
    return user


def get_user_from_access_token(token: str) -> dict[str, Any] | None:
    claims = _decode_token(token)
    if claims is None or claims.get("token_purpose", "access") != "access":
        return None

    user = _user_from_claims(claims)
    if user is None:
        return None
    platform_settings = get_platform_admin_settings()
    mfa_required = bool(platform_settings.get("enforce_mfa")) or bool(user.get("mfa_enabled"))
    if mfa_required and not claims.get("mfa_verified", False):
        return None
    return user


def get_user_from_mfa_token(token: str) -> tuple[dict[str, Any], str] | None:
    claims = _decode_token(token)
    if claims is None or claims.get("token_purpose") not in {"mfa_setup", "mfa_challenge"}:
        return None
    user = _user_from_claims(claims)
    if user is None:
        return None
    return user, claims["token_purpose"]


def get_user_from_mfa_authorization(authorization: str | None) -> tuple[dict[str, Any], str] | None:
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        return None
    token_value = token.strip()
    challenge = get_user_from_mfa_token(token_value)
    if challenge is not None:
        return challenge
    user = get_user_from_access_token(token_value)
    return (user, "access") if user is not None else None


def get_current_user(authorization: str | None) -> dict[str, Any] | None:
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        return None
    return get_user_from_access_token(token.strip())