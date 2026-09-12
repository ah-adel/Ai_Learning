from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import BaseSchema, ProfileAddressMixin, UserRole


class Profile(BaseSchema, ProfileAddressMixin):
    id: str = Field(..., min_length=1, description="Profile identifier.")
    role: UserRole = Field(..., description="Role assigned to the profile.")
    created_at: datetime = Field(..., description="When the profile was created.")
    updated_at: datetime = Field(..., description="When the profile was last updated.")


class ProfileInsert(BaseSchema, ProfileAddressMixin):
    id: str = Field(..., min_length=1, description="Profile identifier.")
    role: UserRole = Field(default="student", description="Profile role.")


class ProfileUpdate(BaseSchema):
    full_name: str | None = Field(default=None, min_length=2, max_length=255, description="Updated full name.")
    role: UserRole | None = Field(default=None, description="Updated platform role.")
    avatar_url: str | None = Field(default=None, description="Updated avatar URL.")
    bio: str | None = Field(default=None, description="Updated profile biography.")

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        sanitized = value.strip()
        if len(sanitized) < 2:
            raise ValueError("Full name must contain at least 2 characters.")
        return sanitized
