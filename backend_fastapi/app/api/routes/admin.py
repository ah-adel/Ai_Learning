from __future__ import annotations

import os
import platform
import resource
import time
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.db import (
    delete_user_by_id,
    delete_course_record,
    get_admin_stats,
    get_admin_activity,
    get_admin_monthly_activity,
    get_admin_students,
    get_student_inspector,
    force_student_enrollment,
    get_all_courses,
    get_admin_course_inspector,
    get_user_by_id,
    update_course_status,
    update_course_admin_fields,
    update_user_role,
    update_user_status,
)
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse

router = APIRouter()
_maintenance_mode = False
_started_at = time.time()


class AdminRoleUpdateRequest(BaseModel):
    role: Literal["student", "instructor", "admin"] = Field(..., description="Updated user role.")


class AdminStatusUpdateRequest(BaseModel):
    status: Literal["active", "inactive", "suspended"] = Field(..., description="Updated user status.")


class AdminCourseStatusUpdateRequest(BaseModel):
    status: Literal["draft", "published", "review", "archived", "approved", "rejected"] = Field(
        ..., description="Course moderation status to apply."
    )


class AdminCourseUpdateRequest(BaseModel):
    instructor_id: str | None = None
    is_featured: bool | None = None


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


@router.get("/admin/activity", response_model=ApiSuccessResponse[list[dict[str, Any]]])
async def admin_activity(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_admin_activity(), message="Admin activity retrieved successfully.")


@router.get("/admin/students", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_students(page: int = 1, page_size: int = 25, search: str = "", status_filter: str = "all", sort_by: str = "created_at", descending: bool = True, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_admin_students(search, status_filter, sort_by, descending, page, page_size), message="Students retrieved successfully.")


@router.get("/admin/students/{student_id}", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_student_detail(student_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    detail = get_student_inspector(student_id)
    if detail is None:
        raise HTTPException(status_code=404, detail={"error": "Student not found."})
    return ApiSuccessResponse(data=detail, message="Student profile retrieved successfully.")


@router.post("/admin/students/{student_id}/force-enrollment", response_model=ApiSuccessResponse[dict[str, bool]])
async def admin_force_enrollment(student_id: str, payload: dict[str, str], authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    course_id = payload.get("course_id", "")
    if not course_id or not force_student_enrollment(student_id, course_id):
        raise HTTPException(status_code=400, detail={"error": "Enrollment could not be created."})
    return ApiSuccessResponse(data={"enrolled": True}, message="Student enrolled successfully.")


@router.post("/admin/students/{student_id}/reset-password", response_model=ApiSuccessResponse[dict[str, bool]])
async def admin_reset_password(student_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    updated = update_user_status(student_id, "active")
    if updated is None:
        raise HTTPException(status_code=404, detail={"error": "Student not found."})
    return ApiSuccessResponse(data={"reset": True}, message="Password reset notification queued.")


@router.post("/admin/students/bulk-notify", response_model=ApiSuccessResponse[dict[str, int]])
async def admin_bulk_notify(payload: dict[str, list[str]], authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, int]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data={"queued": len(payload.get("student_ids", []))}, message="Notifications queued.")


@router.get("/admin/analytics", response_model=ApiSuccessResponse[list[dict[str, Any]]])
async def admin_analytics(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_admin_monthly_activity(), message="Admin analytics retrieved successfully.")


@router.get("/admin/system", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_system(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return ApiSuccessResponse(data={
        "maintenance_mode": _maintenance_mode,
        "python_version": platform.python_version(),
        "platform": platform.system(),
        "process_id": os.getpid(),
        "memory_mb": round(usage.ru_maxrss / (1024 * 1024), 2),
        "uptime_seconds": round(time.time() - _started_at),
    }, message="System status retrieved successfully.")


@router.patch("/admin/system/maintenance", response_model=ApiSuccessResponse[dict[str, bool]])
async def set_maintenance_mode(payload: dict[str, bool], authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    global _maintenance_mode
    _require_admin(authorization)
    _maintenance_mode = bool(payload.get("enabled", False))
    return ApiSuccessResponse(data={"enabled": _maintenance_mode}, message="Maintenance mode updated.")


@router.post("/admin/system/cache/purge", response_model=ApiSuccessResponse[dict[str, bool]])
async def purge_admin_cache(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data={"purged": True}, message="Application cache purge requested.")


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


@router.get("/admin/courses/{course_id}/inspector", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_course_inspector(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    detail = get_admin_course_inspector(course_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})
    return ApiSuccessResponse(data=detail, message="Course inspection data retrieved successfully.")


@router.patch("/admin/courses/{course_id}", response_model=ApiSuccessResponse[dict[str, Any]])
async def update_admin_course(course_id: str, payload: AdminCourseUpdateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    updated_course = update_course_admin_fields(course_id, payload.instructor_id, payload.is_featured)
    if updated_course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})
    return ApiSuccessResponse(data=updated_course, message="Course administration fields updated successfully.")


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


@router.delete("/admin/courses/{course_id}", response_model=ApiSuccessResponse[dict[str, bool]])
async def delete_admin_course(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    if not delete_course_record(course_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})
    return ApiSuccessResponse(data={"deleted": True}, message="Course deleted successfully.")


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
