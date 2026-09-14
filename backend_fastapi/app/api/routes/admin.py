from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.db import (
    delete_user_by_id,
    get_admin_stats,
    get_all_courses,
    get_user_by_id,
    update_course_status,
    update_user_role,
    update_user_status,
)
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse

router = APIRouter()


class AdminRoleUpdateRequest(BaseModel):
    role: Literal["student", "instructor", "admin"] = Field(..., description="Updated user role.")


class AdminStatusUpdateRequest(BaseModel):
    status: Literal["active", "inactive", "suspended"] = Field(..., description="Updated user status.")


class AdminCourseStatusUpdateRequest(BaseModel):
    status: Literal["draft", "published", "review", "archived", "approved", "rejected"] = Field(
        ..., description="Course moderation status to apply."
    )


def _require_admin(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    token = authorization.split(" ", 1)[1].strip()
    current_user = get_user_by_id(token)
    if current_user is None or current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Admin access required."})

    return current_user


@router.get(
    "/admin/stats",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def admin_stats(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    stats = get_admin_stats()
    return ApiSuccessResponse(
        data=stats,
        message="Admin statistics retrieved successfully.",
    )


@router.patch(
    "/admin/users/{user_id}/role",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def update_user_role_route(
    user_id: str,
    payload: AdminRoleUpdateRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    updated_user = update_user_role(user_id, payload.role)
    if updated_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})
    return ApiSuccessResponse(
        data=updated_user,
        message="User role updated successfully.",
    )


@router.patch(
    "/admin/users/{user_id}/status",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def update_user_status_route(
    user_id: str,
    payload: AdminStatusUpdateRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    updated_user = update_user_status(user_id, payload.status)
    if updated_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})
    return ApiSuccessResponse(
        data=updated_user,
        message="User status updated successfully.",
    )


@router.patch(
    "/admin/courses/{course_id}/status",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def update_course_status_route(
    course_id: str,
    payload: AdminCourseStatusUpdateRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    updated_course = update_course_status(course_id, payload.status)
    if updated_course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})
    return ApiSuccessResponse(
        data=updated_course,
        message="Course status updated successfully.",
    )


@router.delete(
    "/admin/users/{user_id}",
    response_model=ApiSuccessResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def delete_user_route(
    user_id: str,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, bool]]:
    current_user = _require_admin(authorization)
    if user_id == current_user.get("id") or user_id == "admin-1":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Protected admin accounts cannot be deleted."})

    deleted = delete_user_by_id(user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})

    return ApiSuccessResponse(
        data={"deleted": True},
        message="User deleted successfully.",
    )


@router.get(
    "/admin/courses",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def list_courses_for_admin(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    courses = get_all_courses()
    return ApiSuccessResponse(
        data=courses,
        message="Courses retrieved successfully.",
    )
