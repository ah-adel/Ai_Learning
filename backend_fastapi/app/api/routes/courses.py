from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.db import (
    create_course_record,
    create_course_review,
    delete_course_record,
    delete_enrollment,
    get_all_courses,
    get_course_by_id,
    get_courses_for_instructor,
    get_platform_admin_settings,
    get_public_courses,
    get_public_platform_stats,
    get_student_enrolled_courses,
    is_student_enrolled,
    upsert_enrollment,
)
from app.schemas.common import ApiErrorResponse, ApiSuccessResponse

router = APIRouter()


class CourseLessonInput(BaseModel):
    id: str | None = None
    title: str = Field(..., min_length=1, max_length=255)
    content: str | None = None
    video_url: str | None = None
    video_name: str | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None
    position: int = Field(default=0, ge=0)
    duration_minutes: int | None = Field(default=None, ge=0)
    duration_seconds: int | None = Field(default=None, ge=0)


class CourseModuleInput(BaseModel):
    id: str | None = None
    title: str = Field(..., min_length=1, max_length=255)
    position: int = Field(default=0, ge=0)
    lessons: list[CourseLessonInput] = Field(default_factory=list)


class CourseCreateRequest(BaseModel):
    id: str | None = Field(default=None, min_length=1)
    instructor_id: str | None = Field(default=None, min_length=1)
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(..., min_length=1, max_length=5000)
    thumbnail_url: str | None = None
    category: str | None = Field(default='General', min_length=1, max_length=200)
    difficulty: str | None = Field(default='Beginner', min_length=1, max_length=30)
    ai_model: str | None = Field(default='Coach Pro', min_length=1, max_length=200)
    status: str | None = Field(default=None, min_length=1, max_length=20)
    is_published: bool | None = Field(default=None, description="Whether the course should be published immediately.")
    modules: list[CourseModuleInput] = Field(default_factory=list)


class CourseReviewRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5, description="Course rating from one to five stars.")
    comment: str = Field(..., min_length=1, max_length=2000, description="Review comment submitted by the enrolled student.")


def _get_current_user(authorization: str | None) -> dict[str, Any] | None:
    return get_current_user(authorization)


@router.get(
    "/courses/public",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}},
)
async def list_public_courses() -> ApiSuccessResponse[list[dict[str, Any]]]:
    courses = get_public_courses()
    return ApiSuccessResponse(
        data=courses,
        message="Published courses retrieved successfully.",
    )


@router.get(
    "/platform/stats",
    response_model=ApiSuccessResponse[dict[str, int | float | None]],
    status_code=status.HTTP_200_OK,
)
async def get_platform_stats() -> ApiSuccessResponse[dict[str, int | float | None]]:
    return ApiSuccessResponse(
        data=get_public_platform_stats(),
        message="Public platform statistics retrieved successfully.",
    )


@router.get(
    "/courses/{course_id}",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def get_course(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    course = get_course_by_id(course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})

    current_user = _get_current_user(authorization)
    if current_user is not None and current_user.get("role") == "admin":
        return ApiSuccessResponse(data=course, message="Course retrieved successfully.")

    if current_user is not None and current_user.get("role") == "instructor" and current_user.get("id") == course.get("instructor_id"):
        return ApiSuccessResponse(data=course, message="Course retrieved successfully.")

    enrolled_student = current_user is not None and current_user.get("role") == "student" and is_student_enrolled(current_user["id"], course_id)
    if not bool(course.get("is_published")) and not enrolled_student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})

    return ApiSuccessResponse(data=course, message="Course retrieved successfully.")


@router.get(
    "/courses",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def list_courses(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    current_user = _get_current_user(authorization)

    if current_user is None:
        return ApiSuccessResponse(
            data=get_public_courses(),
            message="Published courses retrieved successfully.",
        )

    role = current_user.get("role")
    if role == "admin":
        data = get_all_courses()
        message = "All courses retrieved successfully."
    elif role == "instructor":
        data = get_courses_for_instructor(current_user["id"])
        message = "Instructor courses retrieved successfully."
    else:
        data = get_public_courses()
        message = "Published courses retrieved successfully."

    return ApiSuccessResponse(data=data, message=message)


@router.get(
    "/student/courses",
    response_model=ApiSuccessResponse[list[dict[str, Any]]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def list_student_courses(authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[list[dict[str, Any]]]:
    current_user = _get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    if current_user.get("role") not in {"student", "admin"}:
        if current_user.get("role") == "instructor":
            return ApiSuccessResponse(data=get_courses_for_instructor(current_user["id"]), message="Instructor courses retrieved successfully.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Student access required."})

    data = get_student_enrolled_courses(current_user["id"]) if current_user.get("role") == "student" else get_all_courses()
    return ApiSuccessResponse(data=data, message="Student course list retrieved successfully.")


@router.post(
    "/courses/{course_id}/reviews",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def submit_course_review(course_id: str, payload: CourseReviewRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    current_user = _get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if current_user.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Student access required."})
    if not is_student_enrolled(current_user["id"], course_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Only enrolled students can review a course."})

    review = create_course_review(current_user["id"], course_id, payload.rating, payload.comment)
    if review is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Review could not be saved."})

    return ApiSuccessResponse(data=review, message="Course review submitted successfully.")


@router.post(
    "/courses/{course_id}/enroll",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def enroll_in_course(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    current_user = _get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if current_user.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Student access required."})

    course = get_course_by_id(course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})

    enrollment = upsert_enrollment(current_user["id"], course_id)
    if enrollment is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"error": "Enrollment could not be created."})

    return ApiSuccessResponse(data=enrollment, message="Enrollment created successfully.")


@router.delete(
    "/courses/{course_id}/enroll",
    response_model=ApiSuccessResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def unenroll_from_course(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    current_user = _get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if current_user.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Student access required."})

    deleted = delete_enrollment(current_user["id"], course_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Enrollment not found."})

    return ApiSuccessResponse(data={"deleted": True}, message="Enrollment removed successfully.")


@router.post(
    "/courses",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_201_CREATED,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}},
)
async def create_course(payload: CourseCreateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    current_user = _get_current_user(authorization)
    if current_user is None or current_user.get("role") not in {"instructor", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Instructor or admin access required."})

    instructor_id = payload.instructor_id or current_user["id"]
    if current_user.get("role") == "instructor" and instructor_id != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "You can only create courses for your own instructor profile."})

    requested_status = (payload.status or "").strip().lower()
    auto_publish = bool(get_platform_admin_settings().get("autoPublishCourses"))
    if auto_publish:
        normalized_status = "published"
    elif requested_status in {"published", "approved"}:
        normalized_status = "published"
    elif requested_status in {"draft", "review", "archived", "rejected"}:
        normalized_status = "draft" if requested_status in {"draft", "archived", "rejected"} else "review"
    elif payload.is_published is not None:
        normalized_status = "published" if payload.is_published else "draft"
    else:
        normalized_status = "draft"

    publish_flag = True if auto_publish else payload.is_published if payload.is_published is not None else normalized_status == "published"

    course_data = {
        "id": payload.id,
        "instructor_id": instructor_id,
        "title": payload.title,
        "description": payload.description,
        "thumbnail_url": payload.thumbnail_url,
        "category": payload.category or "General",
        "difficulty": payload.difficulty or "Beginner",
        "ai_model": payload.ai_model or "Coach Pro",
        "is_published": publish_flag,
        "status": normalized_status,
        "modules": [module.model_dump(mode="python") for module in payload.modules],
    }

    created_course = create_course_record(course_data)
    return ApiSuccessResponse(
        data=created_course,
        message="Course created successfully.",
    )


@router.put(
    "/courses/{course_id}",
    response_model=ApiSuccessResponse[dict[str, Any]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def update_course(course_id: str, payload: CourseCreateRequest, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, Any]]:
    current_user = _get_current_user(authorization)
    existing_course = get_course_by_id(course_id)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})
    if existing_course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})
    if current_user.get("role") not in {"instructor", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Instructor or admin access required."})
    if current_user.get("role") == "instructor" and existing_course.get("instructor_id") != current_user.get("id"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "You can only update your own courses."})

    updated_payload = payload.model_dump(mode="python")
    updated_payload["id"] = course_id
    updated_payload["instructor_id"] = existing_course["instructor_id"]
    updated_payload["difficulty"] = updated_payload.get("difficulty") or existing_course.get("difficulty") or "Beginner"
    updated_course = create_course_record(updated_payload)
    return ApiSuccessResponse(data=updated_course, message="Course updated successfully.")


@router.delete(
    "/courses/{course_id}",
    response_model=ApiSuccessResponse[dict[str, bool]],
    status_code=status.HTTP_200_OK,
    responses={401: {"model": ApiErrorResponse}, 403: {"model": ApiErrorResponse}, 404: {"model": ApiErrorResponse}},
)
async def delete_course(course_id: str, authorization: str | None = Header(default=None, alias="Authorization")) -> ApiSuccessResponse[dict[str, bool]]:
    current_user = _get_current_user(authorization)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Authentication required."})

    existing_course = get_course_by_id(course_id)
    if existing_course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})

    if current_user.get("role") not in {"instructor", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "Instructor or admin access required."})

    if current_user.get("role") == "instructor" and existing_course.get("instructor_id") != current_user.get("id"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"error": "You can only delete your own courses."})

    deleted = delete_course_record(course_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Course not found."})

    return ApiSuccessResponse(data={"deleted": True}, message="Course deleted successfully.")
