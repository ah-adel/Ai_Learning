from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import BaseSchema, UserRole

PublicSignupRole = Literal["student", "instructor"]


def normalize_email(value: str) -> str:
    return value.strip().lower().replace(" ", "").replace("<", "").replace(">", "")


def is_valid_email(value: str) -> bool:
    import re
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))


class SessionUser(BaseSchema):
    id: str = Field(..., min_length=1, description="Unique authenticated user ID.")
    email: str = Field(..., description="Authenticated email address.")
    role: UserRole = Field(..., description="User role in the platform.")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not is_valid_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class UserSession(BaseSchema):
    user_id: str = Field(..., min_length=1, description="Session user ID.")
    email: str = Field(..., description="Current user email.")
    authenticated: bool = Field(default=True, description="Whether the session is authenticated.")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not is_valid_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class SignInRequest(BaseSchema):
    email: str = Field(..., description="User email to sign in with.")
    password: str = Field(..., min_length=6, max_length=128, description="Password for the user account.")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not is_valid_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class SignUpRequest(BaseSchema):
    email: str = Field(..., description="User email to register.")
    password: str = Field(..., min_length=6, max_length=128, description="Password for registration.")
    full_name: str = Field(..., min_length=2, max_length=120, description="User full name.")
    role: PublicSignupRole = Field(..., description="Role for the new user, limited to student or instructor.")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not is_valid_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class AuthResult(BaseSchema):
    error: str | None = Field(default=None, description="Optional authentication error.")
    user: SessionUser | None = Field(default=None, description="Authenticated user payload.")
    session: UserSession | None = Field(default=None, description="Current user session payload.")


class ResetPasswordRequest(BaseSchema):
    email: str = Field(..., description="Account email to reset the password for.")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not is_valid_email(normalized):
            raise ValueError("Email address is invalid.")
        return normalized


class UpdateProfileRequest(BaseSchema):
    full_name: str | None = Field(default=None, min_length=2, max_length=120, description="Updated display name.")
    avatar_url: str | None = Field(default=None, description="Updated avatar URL.")
    bio: str | None = Field(default=None, description="Updated profile biography.")
    role: UserRole | None = Field(default=None, description="Updated user role.")
