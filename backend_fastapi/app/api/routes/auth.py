from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.db import create_user_record, get_all_users, get_profile_by_user_id, get_user_by_email, get_user_by_id
from app.schemas.auth import SignInRequest, SignUpRequest
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse

router = APIRouter()


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
    return ApiSuccessResponse(
        data={
            "user": {
                "id": user["id"],
                "email": user["email"],
                "role": user["role"],
            },
            "session": {"user_id": user["id"], "email": user["email"], "authenticated": True},
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
    if user is None or user["password"] != normalized_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Invalid email or password."})

    profile = _profile_payload(user)
    return ApiSuccessResponse(
        data={
            "user": {
                "id": user["id"],
                "email": user["email"],
                "role": user["role"],
            },
            "session": {"user_id": user["id"], "email": user["email"], "authenticated": True},
            "profile": profile,
        },
        message="Signed in successfully.",
    )


@router.get(
    "/auth/me",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={404: {"model": ApiErrorResponse}},
)
async def get_me(user_id: str = Query(..., min_length=1, description="User ID to fetch profile for.")) -> ApiSuccessResponse[dict[str, Any]]:
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})

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


@router.get(
    "/users",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def list_users(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[list[dict[str, Any]]]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    token = authorization.split(" ", 1)[1].strip()
    current_user = get_user_by_id(token)
    if current_user is None or current_user["role"] != "admin":
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
