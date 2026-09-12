from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from app.schemas.common import BaseSchema, ChatRole, UserRole, sanitize_text


class AiModelConfig(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    temperature: float | None = Field(default=None, ge=0.0, le=2.0, description="Sampling temperature for the model.")
    max_tokens: int | None = Field(default=None, ge=1, description="Maximum tokens to generate.")
    api_endpoint: str | None = Field(default=None, description="API endpoint for the model provider.")
    system_prompt: str | None = Field(default=None, description="System prompt used for model behavior.")
    extra: dict[str, Any] = Field(default_factory=dict, description="Additional provider-specific configuration keys.")


class AiModel(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    id: str = Field(..., min_length=1, description="AI model identifier.")
    name: str = Field(..., min_length=1, max_length=200, description="Display name for the AI model.")
    provider: str = Field(..., min_length=1, max_length=200, description="Model provider name.")
    model_id: str = Field(..., min_length=1, max_length=200, description="Provider-specific model identifier.")
    is_active: bool = Field(default=False, description="Whether the model is active.")
    config: AiModelConfig = Field(default_factory=AiModelConfig, description="Provider configuration for the model.")
    created_by: str = Field(..., min_length=1, description="User who created the model record.")
    created_at: datetime = Field(..., description="Creation timestamp.")
    updated_at: datetime = Field(..., description="Last update timestamp.")


class AiModelInsert(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    name: str = Field(..., min_length=1, max_length=200, description="Display name for the AI model.")
    provider: str = Field(..., min_length=1, max_length=200, description="Model provider name.")
    model_id: str = Field(..., min_length=1, max_length=200, description="Model identifier on the provider side.")
    is_active: bool = Field(default=False, description="Whether the AI model should be active.")
    config: AiModelConfig | None = Field(default=None, description="Provider configuration values.")
    created_by: str | None = Field(default=None, min_length=1, description="Creator of the model record.")


class AiModelUpdate(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    name: str | None = Field(default=None, min_length=1, max_length=200, description="Updated AI model name.")
    provider: str | None = Field(default=None, min_length=1, max_length=200, description="Updated provider name.")
    model_id: str | None = Field(default=None, min_length=1, max_length=200, description="Updated provider model ID.")
    is_active: bool | None = Field(default=None, description="Updated active state.")
    config: AiModelConfig | None = Field(default=None, description="Updated provider config.")


class StudentProgress(BaseSchema):
    id: str = Field(..., min_length=1, description="Progress record identifier.")
    student_id: str = Field(..., min_length=1, description="Student ID associated with the record.")
    lesson_id: str = Field(..., min_length=1, description="Lesson identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    is_completed: bool = Field(default=False, description="Whether the lesson is complete.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")
    last_accessed_at: datetime = Field(..., description="Last access timestamp.")


class StudentProgressInsert(BaseSchema):
    student_id: str | None = Field(default=None, min_length=1, description="Student identifier.")
    lesson_id: str = Field(..., min_length=1, description="Lesson identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    is_completed: bool = Field(default=False, description="Whether the lesson is completed.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")
    last_accessed_at: datetime | None = Field(default=None, description="Last access timestamp.")


class StudentProgressUpdate(BaseSchema):
    is_completed: bool | None = Field(default=None, description="Updated completion status.")
    completed_at: datetime | None = Field(default=None, description="Updated completion time.")
    last_accessed_at: datetime | None = Field(default=None, description="Updated last access time.")


class ChatMetadata(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    tokens_used: int | None = Field(default=None, ge=0, description="Number of tokens used by the model response.")
    latency_ms: int | None = Field(default=None, ge=0, description="Latency in milliseconds.")
    model_response_id: str | None = Field(default=None, description="Model provider response ID.")
    extra: dict[str, Any] = Field(default_factory=dict, description="Additional metadata fields.")


class AiChatMessage(BaseSchema):
    id: str = Field(..., min_length=1, description="Chat message identifier.")
    student_id: str = Field(..., min_length=1, description="Student that owns the message.")
    course_id: str | None = Field(default=None, description="Course context for the message.")
    lesson_id: str | None = Field(default=None, description="Lesson context for the message.")
    ai_model_id: str | None = Field(default=None, description="Model used for the message.")
    role: ChatRole = Field(..., description="Role of the message author.")
    content: str = Field(..., min_length=1, description="Message content.")
    metadata: ChatMetadata = Field(default_factory=ChatMetadata, description="Metadata associated with the message.")
    created_at: datetime = Field(..., description="Message creation timestamp.")


class AiChatMessageInsert(BaseSchema):
    student_id: str | None = Field(default=None, min_length=1, description="Student associated with the message.")
    course_id: str | None = Field(default=None, description="Course associated with the message.")
    lesson_id: str | None = Field(default=None, description="Lesson associated with the message.")
    ai_model_id: str | None = Field(default=None, description="AI model used for the message.")
    role: ChatRole = Field(..., description="Role of the message author.")
    content: str = Field(..., min_length=1, description="Message content.")
    metadata: ChatMetadata | None = Field(default=None, description="Optional metadata payload.")


class VideoAnalysisRequest(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    video_url: str = Field(..., min_length=1, description="Source URL or file reference for the video to analyze.")
    prompt: str | None = Field(default=None, description="Optional analysis prompt or instructions for the model.")
    model_id: str | None = Field(default=None, min_length=1, description="Identifier of the AI model to use.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Optional metadata associated with the video analysis request.")

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = sanitize_text(value, max_length=5000)
        if not cleaned:
            raise ValueError("Prompt cannot be empty when supplied.")
        return cleaned


class VideoAnalysisResult(BaseSchema):
    model_config = dict(BaseSchema.model_config)
    model_config["protected_namespaces"] = ()

    job_id: str = Field(..., min_length=1, description="Unique job identifier for the analysis request.")
    status: str = Field(..., min_length=1, description="Current status of the analysis job.")
    summary: str | None = Field(default=None, description="Human-readable summary of the video analysis.")
    findings: list[str] = Field(default_factory=list, description="Structured findings from the model output.")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0, description="Confidence score for the summary or predictions.")
    model: str | None = Field(default=None, description="AI model used for the analysis.")
    error: str | None = Field(default=None, description="Error message when the analysis failed.")
    created_at: datetime | None = Field(default=None, description="When the analysis job was created.")
    completed_at: datetime | None = Field(default=None, description="When the analysis job finished.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Provider and job metadata returned by the model backend.")


class CourseSummary(BaseSchema):
    id: str = Field(..., min_length=1, description="Course identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Course title.")
    thumbnail_url: str | None = Field(default=None, description="Course thumbnail URL.")
    description: str = Field(..., min_length=1, max_length=5000, description="Course description.")


class InstructorSummary(BaseSchema):
    id: str = Field(..., min_length=1, description="Instructor identifier.")
    full_name: str = Field(..., min_length=2, max_length=255, description="Instructor full name.")
    avatar_url: str | None = Field(default=None, description="Instructor avatar URL.")


class EnrollmentSummary(BaseSchema):
    id: str = Field(..., min_length=1, description="Enrollment identifier.")
    student_id: str = Field(..., min_length=1, description="Student identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    enrolled_at: datetime = Field(..., description="Enrollment timestamp.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")
    course: CourseSummary | None = Field(default=None, description="Course summary record.")


class StudentProgressSummary(BaseSchema):
    id: str = Field(..., min_length=1, description="Progress record identifier.")
    student_id: str = Field(..., min_length=1, description="Student identifier.")
    lesson_id: str = Field(..., min_length=1, description="Lesson identifier.")
    course_id: str = Field(..., min_length=1, description="Course identifier.")
    is_completed: bool = Field(default=False, description="Whether the lesson is complete.")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp.")
    last_accessed_at: datetime = Field(..., description="Last access timestamp.")


class LessonProgressSummary(BaseSchema):
    id: str = Field(..., min_length=1, description="Lesson identifier.")
    module_id: str = Field(..., min_length=1, description="Module identifier.")
    title: str = Field(..., min_length=1, max_length=255, description="Lesson title.")
    content: str | None = Field(default=None, description="Lesson content.")
    video_url: str | None = Field(default=None, description="Video URL.")
    position: int = Field(default=0, ge=0, description="Lesson position.")
    duration_minutes: int | None = Field(default=None, ge=0, description="Duration in minutes.")
    created_at: datetime = Field(..., description="Lesson creation timestamp.")
    student_progress: list[StudentProgressSummary] = Field(default_factory=list, description="Lesson progress records.")
