from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.schemas.ai import AiChatMessage, AiModel, StudentProgress
from app.schemas.catalog import Course, CourseModule, Enrollment, Lesson, Progress, User
from app.schemas.common import BaseSchema
from app.schemas.profiles import Profile


class LocalInstructorPermission(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    manage_courses: bool = Field(default=False, validation_alias=AliasChoices("manageCourses", "manage_courses"), description="Whether the user can manage courses.")
    moderate_students: bool = Field(default=False, validation_alias=AliasChoices("moderateStudents", "moderate_students"), description="Whether the user can moderate students.")
    view_analytics: bool = Field(default=False, validation_alias=AliasChoices("viewAnalytics", "view_analytics"), description="Whether the user can view analytics.")


class LocalUserRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="Unique user record ID.")
    name: str = Field(..., min_length=2, max_length=120, description="Display name.")
    email: str = Field(..., description="Account email.")
    password: str = Field(..., min_length=6, max_length=128, description="Stored account password.")
    role: Literal["student", "instructor", "admin"] = Field(..., description="Role assigned to the account.")
    avatar: str | None = Field(default=None, description="Optional avatar URL.")
    profile: Profile = Field(..., description="Primary user profile object.")
    status: Literal["active", "inactive", "suspended"] | None = Field(default=None, description="Current status.")
    specialty: str | None = Field(default=None, description="Instructor specialty or domain.")
    joined_at: datetime | None = Field(default=None, validation_alias=AliasChoices("joinedAt", "joined_at"), description="Account join time.")
    permissions: LocalInstructorPermission | None = Field(default=None, description="Instructor permissions.")
    course_ids: list[str] = Field(default_factory=list, validation_alias=AliasChoices("courseIds", "course_ids"), description="Associated course IDs.")


class CourseLessonRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="Lesson record ID.")
    module_id: str | None = Field(default=None, validation_alias=AliasChoices("moduleId", "module_id"), description="Parent module ID.")
    title: str = Field(..., min_length=1, max_length=255, description="Lesson title.")
    summary: str | None = Field(default=None, description="Short lesson summary.")
    type: Literal["Video", "Reading", "Exercise"] = Field(..., description="Lesson content type.")
    video_name: str | None = Field(default=None, validation_alias=AliasChoices("videoName", "video_name"), description="Stored video filename.")
    video_url: str | None = Field(default=None, validation_alias=AliasChoices("videoUrl", "video_url"), description="Video URL.")
    attachment_name: str | None = Field(default=None, validation_alias=AliasChoices("attachmentName", "attachment_name"), description="Attachment filename.")
    attachment_url: str | None = Field(default=None, validation_alias=AliasChoices("attachmentUrl", "attachment_url"), description="Attachment URL.")
    duration: int = Field(default=0, ge=0, description="Lesson duration in seconds.")
    is_free_preview: bool | None = Field(default=None, validation_alias=AliasChoices("isFreePreview", "is_free_preview"), description="Whether the lesson is free preview.")


class CourseModuleRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="Module record ID.")
    course_id: str | None = Field(default=None, validation_alias=AliasChoices("courseId", "course_id"), description="Associated course ID.")
    title: str = Field(..., min_length=1, max_length=255, description="Module title.")
    order: int | None = Field(default=None, ge=0, description="Module ordering.")
    lessons: list[CourseLessonRecord] = Field(default_factory=list, description="Lessons contained in the module.")


class LocalCourseRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="Course record ID.")
    title: str = Field(..., min_length=1, max_length=255, description="Course title.")
    description: str = Field(..., min_length=1, max_length=5000, description="Course description.")
    instructor_id: str = Field(..., validation_alias=AliasChoices("instructorId", "instructor_id"), description="Instructor owning this course.")
    price: float = Field(default=0.0, ge=0, description="Course price.")
    category: str = Field(..., min_length=1, max_length=200, description="Course category.")
    status: Literal["draft", "published", "review"] = Field(..., description="Course publication status.")
    thumbnail: str | None = Field(default=None, description="Course thumbnail URL.")
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = Field(..., description="Course difficulty.")
    is_published: bool = Field(default=False, validation_alias=AliasChoices("isPublished", "is_published"), description="Whether the course is published.")
    created_at: datetime = Field(..., validation_alias=AliasChoices("createdAt", "created_at"), description="Course creation timestamp.")
    ai_model: str | None = Field(default=None, validation_alias=AliasChoices("aiModel", "ai_model"), description="AI model used by the course.")
    modules: list[CourseModuleRecord] | None = Field(default=None, description="Modules associated with the course.")


class LocalEnrollmentRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="Enrollment ID.")
    user_id: str = Field(..., validation_alias=AliasChoices("userId", "user_id"), description="Student user ID.")
    student_id: str = Field(..., validation_alias=AliasChoices("studentId", "student_id"), description="Student identifier.")
    course_id: str = Field(..., validation_alias=AliasChoices("courseId", "course_id"), description="Course ID.")
    progress: int = Field(default=0, ge=0, le=100, description="Current numeric progress percentage.")
    status: Literal["active", "completed"] = Field(..., description="Enrollment status.")
    enrolled_at: datetime = Field(..., validation_alias=AliasChoices("enrolledAt", "enrolled_at"), description="Enrollment timestamp.")
    completed_lesson_ids: list[str] = Field(default_factory=list, validation_alias=AliasChoices("completedLessonIds", "completed_lesson_ids"), description="Completed lesson IDs.")
    progress_percentage: int = Field(default=0, ge=0, le=100, validation_alias=AliasChoices("progressPercentage", "progress_percentage"), description="Progress percentage value.")
    completed_at: datetime | None = Field(default=None, validation_alias=AliasChoices("completedAt", "completed_at"), description="Completion timestamp.")


class LocalAiModelRecord(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1, description="AI model record ID.")
    name: str = Field(..., min_length=1, max_length=200, description="Model display name.")
    provider: str = Field(..., min_length=1, max_length=200, description="Model provider.")
    model_id: str = Field(..., validation_alias=AliasChoices("modelId", "model_id"), description="Provider-specific model name.")
    api_key: str = Field(default="", validation_alias=AliasChoices("apiKey", "api_key"), description="API key for provider authentication.")
    api_endpoint: str = Field(default="", validation_alias=AliasChoices("apiEndpoint", "api_endpoint"), description="Provider API endpoint.")
    system_prompt: str = Field(default="", validation_alias=AliasChoices("systemPrompt", "system_prompt"), description="System prompt.")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0, description="Sampling temperature.")
    max_tokens: int = Field(default=0, ge=0, validation_alias=AliasChoices("maxTokens", "max_tokens"), description="Maximum output tokens.")
    is_active: bool = Field(default=False, validation_alias=AliasChoices("isActive", "is_active"), description="Whether model is active.")
    created_at: datetime = Field(..., validation_alias=AliasChoices("createdAt", "created_at"), description="Creation timestamp.")
    updated_at: datetime = Field(..., validation_alias=AliasChoices("updatedAt", "updated_at"), description="Update timestamp.")


class LocalPlatformSettings(BaseSchema):
    model_config = ConfigDict(populate_by_name=True)

    admin_name: str = Field(..., validation_alias=AliasChoices("adminName", "admin_name"), description="Administrator display name.")
    admin_email: str = Field(..., validation_alias=AliasChoices("adminEmail", "admin_email"), description="Administrator email address.")
    company_name: str = Field(..., validation_alias=AliasChoices("companyName", "company_name"), description="Company name.")
    site_name: str = Field(..., validation_alias=AliasChoices("siteName", "site_name"), description="Public website name.")
    timezone: str = Field(default="UTC", description="Timezone used for the platform.")
    allow_student_signup: bool = Field(default=True, validation_alias=AliasChoices("allowStudentSignup", "allow_student_signup"), description="Allow student self-signup.")
    require_email_verification: bool = Field(default=True, validation_alias=AliasChoices("requireEmailVerification", "require_email_verification"), description="Require email verification.")
    auto_publish_courses: bool = Field(default=False, validation_alias=AliasChoices("autoPublishCourses", "auto_publish_courses"), description="Automatically publish new courses.")
    default_theme: Literal["system", "light", "dark"] = Field(default="system", validation_alias=AliasChoices("defaultTheme", "default_theme"), description="Default application theme.")
    support_email: str = Field(..., validation_alias=AliasChoices("supportEmail", "support_email"), description="Support email address.")
    performance_platform_references: bool = Field(default=True, validation_alias=AliasChoices("performancePlatformReferences", "performance_platform_references"), description="Whether platform performance references are enabled.")


class LocalStorageSeed(BaseSchema):
    users: list[LocalUserRecord] = Field(default_factory=list, description="Seed users.")
    courses: list[LocalCourseRecord] = Field(default_factory=list, description="Seed courses.")
    enrollments: list[LocalEnrollmentRecord] = Field(default_factory=list, description="Seed enrollments.")
    ai_models: list[LocalAiModelRecord] = Field(default_factory=list, description="Seed AI models.")
    settings: LocalPlatformSettings | None = Field(default=None, description="Seed platform settings.")


__all__ = [
    "CourseLessonRecord",
    "CourseModuleRecord",
    "LocalAiModelRecord",
    "LocalCourseRecord",
    "LocalEnrollmentRecord",
    "LocalInstructorPermission",
    "LocalPlatformSettings",
    "LocalStorageSeed",
    "LocalUserRecord",
]
