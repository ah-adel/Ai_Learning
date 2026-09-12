from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import BaseSchema, CourseBase, ProfileAddressMixin, UserRole


class User(BaseSchema):
    id: str = Field(..., min_length=1, description="Unique user identifier.")
    name: str = Field(..., min_length=2, max_length=120, description="User display name.")
    email: str = Field(..., description="User email address.")
    role: UserRole = Field(..., description="Platform role for this user.")
    avatar: str | None = Field(default=None, description="Optional avatar image URL.")


class Course(CourseBase):
    id: str = Field(..., min_length=1, description="Course identifier.")
    instructor_id: str = Field(..., min_length=1, description="Owning instructor identifier.")
    is_published: bool = Field(default=False, description="Whether the course is published.")
    created_at: datetime = Field(..., description="Course creation timestamp.")
    updated_at: datetime = Field(..., description="Last updated timestamp.")


class CourseInsert(CourseBase):
    instructor_id: str | None = Field(default=None, min_length=1, description="Instructor ID of course owner.")
    is_published: bool = Field(default=False, description="Whether the course should be published immediately.")


class CourseUpdate(BaseSchema):
    title: str | None = Field(default=None, min_length=1, max_length=255, description="Updated course title.")
    description: str | None = Field(default=None, min_length=1, max_length=5000, description="Updated course description.")
    thumbnail_url: str | None = Field(default=None, description="Updated thumbnail URL.")
    is_published: bool | None = Field(default=None, description="Updated publication status.")


class CourseModule(BaseSchema):
    id: str = Field(..., min_length=1, description="Course module identifier.")
    course_id: str = Field(..., min_length=1, description="Parent course identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Module title.")
    position: int = Field(default=0, ge=0, description="Sequential position in the course.")
    created_at: datetime = Field(..., description="Module creation timestamp.")


class CourseModuleInsert(BaseSchema):
    course_id: str = Field(..., min_length=1, description="Parent course identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Module title.")
    position: int | None = Field(default=None, ge=0, description="Optional module position.")


class CourseModuleUpdate(BaseSchema):
    title: str | None = Field(default=None, min_length=1, max_length=255, description="Updated module title.")
    position: int | None = Field(default=None, ge=0, description="Updated module position.")


class Lesson(BaseSchema):
    id: str = Field(..., min_length=1, description="Lesson identifier.")
    module_id: str = Field(..., min_length=1, description="Parent module identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Lesson title.")
    content: str | None = Field(default=None, description="Lesson content or markdown.")
    video_url: str | None = Field(default=None, description="Video URL if present.")
    position: int = Field(default=0, ge=0, description="Sequential lesson position.")
    duration_minutes: int | None = Field(default=None, ge=0, description="Lesson duration in minutes.")
    created_at: datetime = Field(..., description="Lesson creation timestamp.")

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()[:20000]


class LessonInsert(BaseSchema):
    module_id: str = Field(..., min_length=1, description="Parent module identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Lesson title.")
    content: str | None = Field(default=None, description="Lesson content.")
    video_url: str | None = Field(default=None, description="Video URL if present.")
    position: int | None = Field(default=None, ge=0, description="Optional lesson position.")
    duration_minutes: int | None = Field(default=None, ge=0, description="Lesson duration in minutes.")


class LessonUpdate(BaseSchema):
    title: str | None = Field(default=None, min_length=1, max_length=255, description="Updated lesson title.")
    content: str | None = Field(default=None, description="Updated lesson content.")
    video_url: str | None = Field(default=None, description="Updated video URL.")
    position: int | None = Field(default=None, ge=0, description="Updated lesson position.")
    duration_minutes: int | None = Field(default=None, ge=0, description="Updated duration in minutes.")


class Enrollment(BaseSchema):
    id: str = Field(..., min_length=1, description="Enrollment identifier.")
    student_id: str = Field(..., min_length=1, description="Student identifier.")
    course_id: str = Field(..., min_length=1, description="Enrolled course identifier.")
    enrolled_at: datetime = Field(..., description="Enrollment timestamp.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")


class EnrollmentInsert(BaseSchema):
    student_id: str | None = Field(default=None, min_length=1, description="Student identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")


class EnrollmentUpdate(BaseSchema):
    completed_at: datetime | None = Field(default=None, description="Updated completion timestamp.")


class Progress(BaseSchema):
    user_id: str = Field(..., min_length=1, description="Student or user identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    completed_lesson_ids: list[str] = Field(default_factory=list, description="Completed lesson IDs.")
    progress_percentage: int = Field(default=0, ge=0, le=100, description="Progress percentage for the course.")


class ModuleWithLessons(BaseSchema):
    id: str = Field(..., min_length=1, description="Module identifier.")
    course_id: str = Field(..., min_length=1, description="Parent course identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Module title.")
    position: int = Field(default=0, ge=0, description="Module position.")
    created_at: datetime = Field(..., description="Creation timestamp.")
    lessons: list[Lesson] = Field(default_factory=list, description="Lessons contained in this module.")


class CourseWithInstructor(BaseSchema):
    id: str = Field(..., min_length=1, description="Course identifier.")
    instructor_id: str = Field(..., min_length=1, description="Instructor identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Course title.")
    description: str = Field(..., min_length=1, max_length=5000, description="Course description.")
    thumbnail_url: str | None = Field(default=None, description="Thumbnail URL.")
    is_published: bool = Field(default=False, description="Whether the course is published.")
    created_at: datetime = Field(..., description="Course creation timestamp.")
    updated_at: datetime = Field(..., description="Last updated timestamp.")
    instructor: dict[str, str | None] = Field(default_factory=dict, description="Instructor profile summary.")


class CourseWithModules(BaseSchema):
    id: str = Field(..., min_length=1, description="Course identifier.")
    instructor_id: str = Field(..., min_length=1, description="Instructor identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Course title.")
    description: str = Field(..., min_length=1, max_length=5000, description="Course description.")
    thumbnail_url: str | None = Field(default=None, description="Thumbnail URL.")
    is_published: bool = Field(default=False, description="Whether the course is published.")
    created_at: datetime = Field(..., description="Course creation timestamp.")
    updated_at: datetime = Field(..., description="Last updated timestamp.")
    course_modules: list[CourseModule] = Field(default_factory=list, description="Course modules.")


class EnrollmentWithCourse(BaseSchema):
    id: str = Field(..., min_length=1, description="Enrollment identifier.")
    student_id: str = Field(..., min_length=1, description="Student identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    enrolled_at: datetime = Field(..., description="Enrollment timestamp.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")
    course: dict[str, str | None] = Field(default_factory=dict, description="Course summary data.")


class LessonWithProgress(BaseSchema):
    id: str = Field(..., min_length=1, description="Lesson identifier.")
    module_id: str = Field(..., min_length=1, description="Parent module identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Lesson title.")
    content: str | None = Field(default=None, description="Lesson content.")
    video_url: str | None = Field(default=None, description="Video URL if present.")
    position: int = Field(default=0, ge=0, description="Lesson position.")
    duration_minutes: int | None = Field(default=None, ge=0, description="Lesson duration in minutes.")
    created_at: datetime = Field(..., description="Lesson creation timestamp.")
    student_progress: list[dict[str, Any]] = Field(default_factory=list, description="Student progress records for this lesson.")
