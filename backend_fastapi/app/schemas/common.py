from __future__ import annotations

import re
from typing import Any, Generic, Literal, TypeVar

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

UserRole = Literal["student", "instructor", "admin"]
ChatRole = Literal["user", "assistant", "system"]
CourseStatus = Literal["draft", "published", "review", "Draft", "Published", "Review"]
MediaUploadKind = Literal["video", "attachment"]


def sanitize_text(value: str, max_length: int = 200) -> str:
    if not isinstance(value, str):
        raise TypeError("Expected a string value")
    cleaned = re.sub(r"[\u0000-\u001F\u007F]", "", value)
    cleaned = cleaned.replace("<", "").replace(">", "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_length]


def normalize_email(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Expected a string value")
    return value.strip().lower().replace(" ", "").replace("<", "").replace(">", "")


def validate_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))


class BaseSchema(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        validate_assignment=True,
        populate_by_name=True,
        protected_namespaces=(),
    )


class ErrorDetail(BaseSchema):
    message: str = Field(..., min_length=1, description="Error message for the failing field or operation.")
    path: str | None = Field(default=None, description="Optional path or field name associated with the error.")


T = TypeVar("T")


class ApiSuccessResponse(BaseSchema, Generic[T]):
    success: Literal[True] = Field(default=True, description="Indicates the request succeeded.")
    data: T = Field(..., description="The response payload.")
    message: str | None = Field(default=None, description="Optional success message.")


class ApiErrorResponse(BaseSchema):
    success: Literal[False] = Field(default=False, description="Indicates the request failed.")
    error: str = Field(..., min_length=1, description="Primary error message.")
    details: Any | None = Field(default=None, description="Additional structured details for the error.")


class PasswordMixin:
    @staticmethod
    def _validate_password(value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 6 or len(cleaned) > 128:
            raise ValueError("Password must be between 6 and 128 characters long.")
        return cleaned


class CoreUser(BaseSchema):
    id: str = Field(..., min_length=1, description="Unique user identifier.")
    name: str = Field(..., min_length=2, max_length=120, description="Display name for the user.")
    email: str = Field(..., description="Email address for the user.")
    role: UserRole = Field(..., description="User role in the platform.")
    avatar: str | None = Field(default=None, description="Optional avatar URL.")

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        sanitized = sanitize_text(value, max_length=120)
        if len(sanitized) < 2:
            raise ValueError("Name must contain at least 2 characters.")
        return sanitized

    @field_validator("email")
    @classmethod
    def validate_email_field(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not validate_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class ProfileAddressMixin:
    full_name: str = Field(..., min_length=2, max_length=255, description="Full display name of the profile.")
    avatar_url: str | None = Field(default=None, description="Absolute or relative avatar URL.")
    bio: str | None = Field(default=None, description="Short biography or profile summary.")

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        sanitized = sanitize_text(value, max_length=255)
        if len(sanitized) < 2:
            raise ValueError("Full name must contain at least 2 characters.")
        return sanitized

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return sanitize_text(value, max_length=2000)


class CourseBase(BaseSchema):
    title: str = Field(..., min_length=1, max_length=255, description="Course title.")
    description: str = Field(..., min_length=1, max_length=5000, description="Course description.")
    thumbnail_url: str | None = Field(default=None, description="Course thumbnail URL.")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        return sanitize_text(value, max_length=255)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        return sanitize_text(value, max_length=5000)


class MediaUploadResult(BaseSchema):
    url: str = Field(..., min_length=1, description="Uploaded media URL.")
    folder: Literal["videos", "attachments"] = Field(..., description="Media storage folder.")
    type: MediaUploadKind = Field(..., description="Media upload kind.")
    file_name: str = Field(
        ...,
        min_length=1,
        validation_alias=AliasChoices("file_name", "fileName"),
        description="Stored file name.",
    )
    original_name: str = Field(
        ...,
        min_length=1,
        validation_alias=AliasChoices("original_name", "originalName"),
        description="Original uploaded file name.",
    )

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("URL cannot be empty.")
        return value


class DeleteCleanupResult(BaseSchema):
    entity_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("entity_id", "entityId"),
        description="Identifier of the deleted entity.",
    )
    deleted_files: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("deleted_files", "deletedFiles"),
        description="Files removed by cleanup.",
    )
    purged_collections: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("purged_collections", "purgedCollections"),
        description="Collections purged by cleanup.",
    )
    errors: list[ErrorDetail] = Field(default_factory=list, description="Error details encountered during cleanup.")
