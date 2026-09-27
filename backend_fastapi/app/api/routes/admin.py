from __future__ import annotations

import os
import platform
import secrets
import smtplib
import time
from email.message import EmailMessage
from typing import Any, Literal

try:
    import resource
except ModuleNotFoundError:  # pragma: no cover - Windows / non-Unix environments
    resource = None

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator
import psycopg2

from app.db import (
    delete_user_by_id,
    delete_course_record,
    create_bulk_student_notifications,
    create_user_record,
    create_admin_notification,
    get_admin_instructors,
    get_all_users,
    get_platform_admin_settings,
    get_admin_stats,
    get_admin_activity,
    get_admin_monthly_activity,
    get_admin_students,
    get_student_inspector,
    force_student_enrollment,
    get_all_courses,
    get_admin_course_inspector,
    get_user_by_id,
    purge_orphaned_uploads,
    reassign_instructor_courses,
    save_platform_admin_settings,
    update_course_status,
    update_course_admin_fields,
    update_user_role,
    update_user_status,
    update_admin_instructor,
    update_user_password,
)
from app.core.security import create_access_token, get_current_user
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse, validate_email
from app.services.cleanup_service import purge_temp_storage, storage_snapshot
from app.services.media_service import UPLOAD_ROOT

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


class AdminUserCreateRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    role: Literal["student", "instructor", "admin"] = "student"
    status: Literal["active", "inactive", "suspended"] = "active"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not validate_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class AdminInstructorCreateRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    specialty: str = Field(default="General Instruction", min_length=1, max_length=160)
    status: Literal["active", "inactive", "suspended"] = "active"
    permissions: dict[str, Any] = Field(default_factory=dict)
    course_ids: list[str] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not validate_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class AdminInstructorUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    specialty: str | None = Field(default=None, min_length=1, max_length=160)
    status: Literal["active", "inactive", "suspended"] | None = None
    permissions: dict[str, Any] | None = None
    verification_status: Literal["pending", "approved", "rejected"] | None = None
    is_verified: bool | None = None
    payout_status: Literal["pending", "paid"] | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not validate_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class InstructorCourseAssignmentRequest(BaseModel):
    course_ids: list[str] = Field(default_factory=list)


class AdminEmailTestRequest(BaseModel):
    recipient: str = Field(..., min_length=3, max_length=254)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    username: str = ""
    password: str = ""
    from_email: str = Field(..., min_length=3, max_length=254)
    use_tls: bool = True


def _require_admin(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    current_user = get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Admin access required."})

    return current_user


def _require_platform_owner(user: dict[str, Any]) -> None:
    if user.get("id") != "admin-1":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Only the platform owner can modify administrator roles."})


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


@router.post("/admin/students/{student_id}/reset-password", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_reset_password(student_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    current_admin = _require_admin(authorization)
    student = get_user_by_id(student_id)
    if student is None or student.get("role") != "student":
        raise HTTPException(status_code=404, detail={"error": "Student not found."})
    temporary_password = secrets.token_urlsafe(15)
    if not update_user_password(student_id, temporary_password):
        raise HTTPException(status_code=404, detail={"error": "Student not found."})
    create_admin_notification(
        student_id,
        "Password changed by an administrator",
        "Your password was reset by platform administration. Contact support if you did not request this change.",
        current_admin["id"],
    )
    return ApiSuccessResponse(
        data={"reset": True, "temporary_password": temporary_password},
        message="The password was reset. Share the temporary password securely with the student.",
    )


@router.post("/admin/students/bulk-notify", response_model=ApiSuccessResponse[dict[str, int]])
async def admin_bulk_notify(payload: dict[str, list[str]], authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, int]]:
    current_admin = _require_admin(authorization)
    queued = create_bulk_student_notifications(payload.get("student_ids", []), current_admin["id"])
    return ApiSuccessResponse(data={"queued": queued}, message="Notifications saved for delivery in the platform inbox.")


@router.get("/admin/analytics", response_model=ApiSuccessResponse[list[dict[str, Any]]])
async def admin_analytics(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_admin_monthly_activity(), message="Admin analytics retrieved successfully.")


@router.get("/admin/system", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_system(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    memory_mb = 0.0
    if resource is not None:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        memory_mb = round(usage.ru_maxrss / (1024 * 1024), 2)

    return ApiSuccessResponse(data={
        "maintenance_mode": _maintenance_mode,
        "python_version": platform.python_version(),
        "platform": platform.system(),
        "process_id": os.getpid(),
        "memory_mb": memory_mb,
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
    current_admin = _require_admin(authorization)
    target_user = get_user_by_id(user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "User not found."})
    if payload.role == "admin" or target_user.get("role") == "admin":
        _require_platform_owner(current_admin)
    if user_id == "admin-1" and payload.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "The platform owner role cannot be changed."})
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


@router.post("/admin/media/purge-orphans", response_model=ApiSuccessResponse[dict[str, int]])
async def purge_orphaned_media_route(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ApiSuccessResponse[dict[str, int]]:
    _require_admin(authorization)
    result = purge_orphaned_uploads()
    return ApiSuccessResponse(data=result, message="Orphaned media cleanup completed.")


def _user_response(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "status": user["status"],
        "avatar": user.get("avatar"),
        "specialty": user.get("specialty"),
        "joined_at": user.get("joined_at"),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


def _create_admin_managed_user(
    payload: AdminUserCreateRequest,
    actor: dict[str, Any],
    *,
    specialty: str | None = None,
    permissions: dict[str, Any] | None = None,
    bio: str | None = None,
) -> dict[str, Any]:
    if get_user_by_id(actor["id"]) is None:
        raise HTTPException(status_code=401, detail={"error": "Authentication required."})
    if get_all_users() and any(user["email"].lower() == payload.email.lower() for user in get_all_users()):
        raise HTTPException(status_code=409, detail={"error": "An account with that email already exists."})
    if payload.role == "admin" and actor.get("id") != "admin-1":
        raise HTTPException(status_code=403, detail={"error": "Only the platform owner can create administrator accounts."})

    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    try:
        user = create_user_record({
            "id": str(__import__("uuid").uuid4()),
            "name": payload.full_name.strip(),
            "email": payload.email,
            "password": payload.password,
            "role": payload.role,
            "status": payload.status,
            "specialty": specialty,
            "permissions": permissions or {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1},
            "joined_at": now,
            "created_at": now,
            "updated_at": now,
            "profile_full_name": payload.full_name.strip(),
            "profile_avatar_url": None,
            "profile_bio": bio,
        })
    except psycopg2.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail={"error": "An account with that email already exists."}) from exc
    return user


@router.get("/admin/users", response_model=ApiSuccessResponse[list[dict[str, Any]]])
async def admin_list_users(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=[_user_response(user) for user in get_all_users()], message="Users retrieved successfully.")


@router.post("/admin/users", response_model=ApiSuccessResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def admin_create_user(payload: AdminUserCreateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    actor = _require_admin(authorization)
    user = _create_admin_managed_user(payload, actor)
    return ApiSuccessResponse(data=_user_response(user), message="User account created successfully.")


@router.post("/admin/students", response_model=ApiSuccessResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def admin_create_student(payload: AdminUserCreateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    actor = _require_admin(authorization)
    student_payload = payload.model_copy(update={"role": "student"})
    user = _create_admin_managed_user(student_payload, actor, bio="Student account created by platform administration.")
    return ApiSuccessResponse(data=_user_response(user), message="Student account created successfully.")


@router.post("/admin/instructors", response_model=ApiSuccessResponse[dict[str, Any]], status_code=status.HTTP_201_CREATED)
async def admin_create_instructor(payload: AdminInstructorCreateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    actor = _require_admin(authorization)
    user_payload = AdminUserCreateRequest(
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        role="instructor",
        status=payload.status,
    )
    if payload.course_ids:
        existing_course_ids = {course["id"] for course in get_all_courses()}
        if not set(payload.course_ids).issubset(existing_course_ids):
            raise HTTPException(status_code=400, detail={"error": "One or more assigned courses do not exist."})
    user = _create_admin_managed_user(
        user_payload,
        actor,
        specialty=payload.specialty,
        permissions=payload.permissions,
        bio="Instructor and course mentor.",
    )
    if payload.course_ids and not reassign_instructor_courses(user["id"], payload.course_ids):
        delete_user_by_id(user["id"])
        raise HTTPException(status_code=400, detail={"error": "Course assignments could not be saved."})
    instructor = next((item for item in get_admin_instructors() if item["id"] == user["id"]), None)
    return ApiSuccessResponse(data=instructor or _user_response(user), message="Instructor account created successfully.")


@router.get("/admin/instructors", response_model=ApiSuccessResponse[list[dict[str, Any]]])
async def admin_list_instructors(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_admin_instructors(), message="Instructors retrieved successfully.")


@router.patch("/admin/instructors/{instructor_id}", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_update_instructor(instructor_id: str, payload: AdminInstructorUpdateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    try:
        updated = update_admin_instructor(instructor_id, payload.model_dump(exclude_unset=True))
    except psycopg2.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail={"error": "An account with that email already exists."}) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail={"error": "Instructor not found."})
    return ApiSuccessResponse(data=updated, message="Instructor account updated successfully.")


@router.delete("/admin/instructors/{instructor_id}", response_model=ApiSuccessResponse[dict[str, bool]])
async def admin_delete_instructor(instructor_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    actor = _require_admin(authorization)
    if instructor_id == actor["id"] or instructor_id == "admin-1":
        raise HTTPException(status_code=403, detail={"error": "Protected accounts cannot be deleted."})
    if not delete_user_by_id(instructor_id):
        raise HTTPException(status_code=404, detail={"error": "Instructor not found."})
    return ApiSuccessResponse(data={"deleted": True}, message="Instructor account deleted successfully.")


@router.put("/admin/instructors/{instructor_id}/courses", response_model=ApiSuccessResponse[dict[str, bool]])
async def admin_assign_instructor_courses(instructor_id: str, payload: InstructorCourseAssignmentRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    if not reassign_instructor_courses(instructor_id, payload.course_ids):
        raise HTTPException(status_code=400, detail={"error": "Instructor or one or more courses were not found."})
    return ApiSuccessResponse(data={"reassigned": True}, message="Instructor course assignments updated.")


@router.post("/admin/instructors/{instructor_id}/impersonate", response_model=ApiSuccessResponse[dict[str, str]])
async def admin_prepare_instructor_impersonation(instructor_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, str]]:
    _require_admin(authorization)
    instructor = get_user_by_id(instructor_id)
    if instructor is None or instructor.get("role") != "instructor":
        raise HTTPException(status_code=404, detail={"error": "Instructor not found."})
    return ApiSuccessResponse(
        data={
            "user_id": instructor_id,
            "role": "instructor",
            "email": instructor["email"],
            "access_token": create_access_token(instructor_id, "instructor"),
        },
        message="Instructor session prepared.",
    )


@router.get("/admin/settings", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_get_settings(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=get_platform_admin_settings(), message="Platform settings retrieved successfully.")


@router.put("/admin/settings", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_save_settings(payload: dict[str, Any], authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    try:
        saved = save_platform_admin_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"error": str(exc)}) from exc
    return ApiSuccessResponse(data=saved, message="Platform settings saved successfully.")


@router.get("/admin/storage", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_storage_snapshot(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=storage_snapshot(UPLOAD_ROOT), message="Storage usage retrieved successfully.")


@router.post("/admin/storage/cleanup", response_model=ApiSuccessResponse[dict[str, Any]])
async def admin_cleanup_temp_storage(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    _require_admin(authorization)
    return ApiSuccessResponse(data=purge_temp_storage(UPLOAD_ROOT), message="Temporary storage cleanup completed.")


@router.post("/admin/settings/test-email", response_model=ApiSuccessResponse[dict[str, bool]])
async def admin_test_email(payload: AdminEmailTestRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    _require_admin(authorization)
    message = EmailMessage()
    message["Subject"] = "Fasl_ai SMTP test"
    message["From"] = payload.from_email
    message["To"] = payload.recipient
    message.set_content("This is a test message from the Fasl_ai platform administrator.")
    try:
        with smtplib.SMTP(payload.host, payload.port, timeout=10) as server:
            server.ehlo()
            if payload.use_tls:
                server.starttls()
                server.ehlo()
            if payload.username:
                server.login(payload.username, payload.password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=502, detail={"error": f"SMTP test failed: {exc}"}) from exc
    return ApiSuccessResponse(data={"sent": True}, message="Test email sent successfully.")
