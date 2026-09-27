from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pyotp
from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import create_access_token, get_current_user, get_user_from_mfa_authorization
from app.db import (
    create_user_record,
    enable_user_mfa,
    get_all_users,
    get_platform_admin_settings,
    get_profile_by_user_id,
    get_user_by_email,
    get_user_mfa_lock,
    get_user_mfa_secret,
    record_failed_mfa_attempt,
    reset_user_mfa_attempts,
    save_pending_mfa_secret,
    update_user_account,
    upgrade_user_password_hash,
    verify_password,
)
from app.schemas.auth import AccountProfileUpdate, SignInRequest, SignUpRequest
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse

router = APIRouter()


class MfaVerificationRequest(BaseModel):
    code: str = Field(..., pattern=r"^\d{6}$")


def _auth_result(user: dict[str, Any], profile: dict[str, Any], access_token: str) -> ApiSuccessResponse[dict[str, Any]]:
    return ApiSuccessResponse(
        data={
            "user": {"id": user["id"], "email": user["email"], "role": user["role"]},
            "session": {
                "user_id": user["id"],
                "email": user["email"],
                "authenticated": True,
                "access_token": access_token,
                "token_type": "bearer",
            },
            "profile": profile,
        },
        message="Signed in successfully.",
    )


def _mfa_challenge_result(user: dict[str, Any], setup_required: bool) -> ApiSuccessResponse[dict[str, Any]]:
    purpose = "mfa_setup" if setup_required else "mfa_challenge"
    return ApiSuccessResponse(
        data={
            "user": {"id": user["id"], "email": user["email"], "role": user["role"]},
            "mfa_required": not setup_required,
            "mfa_setup_required": setup_required,
            "challenge_token": create_access_token(
                user["id"], user["role"], token_purpose=purpose, expires_minutes=5
            ),
        },
        message="Complete multi-factor authentication to continue.",
    )


def _profile_payload(user: dict[str, Any]) -> dict[str, Any]:
    profile = get_profile_by_user_id(user["id"]) or {
        "id": user["id"],
        "full_name": user["name"],
        "role": user["role"],
        "avatar_url": user.get("avatar"),
        "bio": None,
        "created_at": user.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "updated_at": user.get("updated_at") or datetime.now(timezone.utc).isoformat(),
    }
    return {
        "id": profile["id"],
        "full_name": profile["full_name"],
        "role": profile["role"],
        "avatar_url": profile.get("avatar_url"),
        "bio": profile.get("bio"),
        "created_at": profile["created_at"],
        "updated_at": profile["updated_at"],
    }


@router.post(
    "/auth/sign-up",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": ApiErrorResponse}, 409: {"model": ApiErrorResponse}},
)
async def sign_up(payload: SignUpRequest) -> ApiSuccessResponse[dict[str, Any]]:
    normalized_email = payload.email.strip().lower()
    normalized_password = payload.password.strip()
    platform_settings = get_platform_admin_settings()
    if payload.role == "student" and not platform_settings.get("allowStudentSignup", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Student registration is currently closed."})
    existing = get_user_by_email(normalized_email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "An account with that email already exists."})

    now = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())
    user = create_user_record({
        "id": user_id,
        "name": payload.full_name.strip(),
        "email": normalized_email,
        "password": normalized_password,
        "role": payload.role,
        "status": "active",
        "verification_status": "pending" if payload.role == "instructor" else "approved",
        "avatar": None,
        "permissions": {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1},
        "joined_at": now,
        "created_at": now,
        "updated_at": now,
        "profile_full_name": payload.full_name.strip(),
        "profile_avatar_url": None,
        "profile_bio": None,
    })

    profile = _profile_payload(user)
    if platform_settings.get("enforce_mfa"):
        return _mfa_challenge_result(user, setup_required=True)
    access_token = create_access_token(user["id"], user["role"])
    return ApiSuccessResponse(
        data={
            "user": {
                "id": user["id"],
                "email": user["email"],
                "role": user["role"],
            },
            "session": {"user_id": user["id"], "email": user["email"], "authenticated": True, "access_token": access_token, "token_type": "bearer"},
            "profile": profile,
        },
        message="Account created successfully.",
    )


@router.post(
    "/auth/sign-in",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={400: {"model": ApiErrorResponse}, 401: {"model": ApiErrorResponse}},
)
async def sign_in(payload: SignInRequest) -> ApiSuccessResponse[dict[str, Any]]:
    normalized_email = payload.email.strip().lower()
    normalized_password = payload.password.strip()
    user = get_user_by_email(normalized_email)
    if user is None or user.get("status") != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Invalid email or password."})
    password_valid, needs_upgrade = verify_password(normalized_password, user["password"])
    if not password_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Invalid email or password."})
    if needs_upgrade:
        upgrade_user_password_hash(user["id"], normalized_password)

    platform_settings = get_platform_admin_settings()
    if platform_settings.get("enforce_mfa") or user.get("mfa_enabled"):
        mfa_lock = get_user_mfa_lock(user["id"])
        if mfa_lock and mfa_lock[1] and mfa_lock[1] > datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"error": "Multi-factor verification is temporarily locked. Try again later."})
        return _mfa_challenge_result(user, setup_required=not user.get("mfa_enabled", False))

    profile = _profile_payload(user)
    access_token = create_access_token(user["id"], user["role"])
    return _auth_result(user, profile, access_token)


@router.post("/auth/mfa/setup", response_model=ApiSuccessResponse[dict[str, str]])
async def setup_mfa(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, str]]:
    authentication = get_user_from_mfa_authorization(authorization)
    if authentication is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    user, token_purpose = authentication
    if token_purpose == "mfa_challenge":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "A verification challenge cannot start MFA enrollment."})

    secret = pyotp.random_base32()
    if not save_pending_mfa_secret(user["id"], secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Account is unavailable."})
    totp = pyotp.TOTP(secret)
    return ApiSuccessResponse(
        data={
            "secret": secret,
            "otpauth_url": totp.provisioning_uri(name=user["email"], issuer_name=settings.app_name),
        },
        message="Add this account to an authenticator app, then verify the current code.",
    )


@router.post("/auth/mfa/verify", response_model=ApiSuccessResponse[dict[str, Any]])
async def verify_mfa(
    payload: MfaVerificationRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, Any]]:
    authentication = get_user_from_mfa_authorization(authorization)
    if authentication is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    user, token_purpose = authentication
    lock = get_user_mfa_lock(user["id"])
    if lock and lock[1] and lock[1] > datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"error": "Multi-factor verification is temporarily locked. Try again later."})

    enrolling = token_purpose in {"mfa_setup", "access"}
    secret = get_user_mfa_secret(user["id"], pending=enrolling)
    if not secret:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "MFA setup is required before verification."})
    if not pyotp.TOTP(secret).verify(payload.code, valid_window=1):
        record_failed_mfa_attempt(user["id"])
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "The authenticator code is invalid."})

    if enrolling and not enable_user_mfa(user["id"]):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "MFA enrollment could not be completed."})
    reset_user_mfa_attempts(user["id"])
    refreshed_user = {**user, "mfa_enabled": True}
    access_token = create_access_token(user["id"], user["role"], mfa_verified=True)
    return _auth_result(refreshed_user, _profile_payload(user), access_token)


@router.get(
    "/auth/me",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={404: {"model": ApiErrorResponse}},
)
async def get_me(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    user = get_current_user(authorization)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    profile = _profile_payload(user)
    return ApiSuccessResponse(
        data={
            "user": {
                "id": user["id"],
                "email": user["email"],
                "role": user["role"],
            },
            "profile": profile,
        },
        message="Profile loaded successfully.",
    )


@router.patch(
    "/auth/profile",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}, 409: {"model": ApiErrorResponse}},
)
async def update_profile(
    payload: AccountProfileUpdate,
    user_id: str = Query(..., min_length=1),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, Any]]:
    current_user = get_current_user(authorization)
    if current_user is None or current_user["id"] != user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    existing_email_owner = get_user_by_email(payload.email)
    if existing_email_owner is not None and existing_email_owner["id"] != user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "An account with that email already exists."})

    user = update_user_account(user_id, payload.full_name, payload.email, payload.bio)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})

    return ApiSuccessResponse(
        data={
            "user": {"id": user["id"], "email": user["email"], "role": user["role"]},
            "profile": _profile_payload(user),
        },
        message="Profile updated successfully.",
    )


@router.get(
    "/users",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def list_users(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[list[dict[str, Any]]]:
    current_user = get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Admin access required."})

    users = get_all_users()
    normalized_users = [
        {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
            "status": user["status"],
            "avatar": user.get("avatar"),
            "joined_at": user.get("joined_at"),
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
        }
        for user in users
    ]

    return ApiSuccessResponse(
        data=normalized_users,
        message="Users retrieved successfully.",
    )


@router.post(
    "/auth/sign-out",
    response_model=ApiSuccessResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
)
async def sign_out() -> ApiSuccessResponse[dict[str, bool]]:
    return ApiSuccessResponse(data={"signed_out": True}, message="Signed out successfully.")
