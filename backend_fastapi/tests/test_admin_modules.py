from __future__ import annotations

import json
import uuid
from pathlib import Path

import jwt
import pytest
import pyotp
from fastapi.testclient import TestClient

from app import db
from app.api.routes import admin as admin_routes
from app.core.config import settings
from app.core.security import create_access_token
from app.main import app

client = TestClient(app)
ADMIN_HEADERS = {"Authorization": f"Bearer {create_access_token('admin-1', 'admin')}"}


def _email() -> str:
    return f"admin-module-{uuid.uuid4().hex}@example.com"


def _signup_user(role: str = "student") -> dict:
    response = client.post(
        "/api/auth/sign-up",
        json={"email": _email(), "password": "SecurePass123", "full_name": "Role Test User", "role": role},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_admin_creates_student_with_hashed_password_and_profile() -> None:
    email = _email()
    created = client.post(
        "/api/admin/students",
        headers=ADMIN_HEADERS,
        json={"full_name": "Created Student", "email": email, "password": "SecurePass123"},
    )
    assert created.status_code == 201, created.text
    user = created.json()["data"]
    user_id = user["id"]
    assert user["role"] == "student"
    assert "password" not in user

    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT password FROM users WHERE id = %s", (user_id,))
            stored_password = cursor.fetchone()[0]
            cursor.execute("SELECT full_name, role FROM profiles WHERE id = %s", (user_id,))
            profile = cursor.fetchone()
    assert stored_password.startswith("pbkdf2_sha256$")
    assert stored_password != "SecurePass123"
    assert profile == ("Created Student", "student")

    signed_in = client.post("/api/auth/sign-in", json={"email": email, "password": "SecurePass123"})
    assert signed_in.status_code == 200, signed_in.text

    duplicate = client.post(
        "/api/admin/students",
        headers=ADMIN_HEADERS,
        json={"full_name": "Duplicate Student", "email": email, "password": "SecurePass123"},
    )
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["error"]


def test_admin_instructor_crud_and_course_controls_are_persistent() -> None:
    email = _email()
    created = client.post(
        "/api/admin/instructors",
        headers=ADMIN_HEADERS,
        json={
            "full_name": "Managed Instructor",
            "email": email,
            "password": "SecurePass123",
            "specialty": "Learning Design",
            "permissions": {"manageCourses": True, "moderateStudents": False, "viewAnalytics": True},
        },
    )
    assert created.status_code == 201, created.text
    instructor_id = created.json()["data"]["id"]

    listed = client.get("/api/admin/instructors", headers=ADMIN_HEADERS)
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json()["data"] if item["id"] == instructor_id)
    assert row["specialty"] == "Learning Design"
    assert row["permissions"]["moderateStudents"] is False

    impersonated = client.post(f"/api/admin/instructors/{instructor_id}/impersonate", headers=ADMIN_HEADERS)
    assert impersonated.status_code == 200, impersonated.text
    impersonation_token = impersonated.json()["data"]["access_token"]
    assert impersonation_token != instructor_id
    assert client.get("/api/courses", headers={"Authorization": f"Bearer {impersonation_token}"}).status_code == 200

    updated = client.patch(
        f"/api/admin/instructors/{instructor_id}",
        headers=ADMIN_HEADERS,
        json={"full_name": "Updated Instructor", "verification_status": "approved", "is_verified": True},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["name"] == "Updated Instructor"
    assert updated.json()["data"]["verification_status"] == "approved"

    deleted = client.delete(f"/api/admin/instructors/{instructor_id}", headers=ADMIN_HEADERS)
    assert deleted.status_code == 200, deleted.text
    assert db.get_user_by_id(instructor_id) is None


def test_instructor_earnings_count_every_enrollment_for_equal_price_courses() -> None:
    instructor_response = client.post(
        "/api/auth/sign-up",
        json={"email": _email(), "password": "SecurePass123", "full_name": "Revenue Instructor", "role": "instructor"},
    )
    assert instructor_response.status_code == 201, instructor_response.text
    instructor_id = instructor_response.json()["data"]["user"]["id"]
    student_ids = [_signup_user()["user"]["id"] for _ in range(2)]
    course_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            for index, course_id in enumerate(course_ids, start=1):
                cursor.execute(
                    """
                    INSERT INTO courses (id, instructor_id, title, description, price, status, category, difficulty, ai_model, is_published)
                    VALUES (%s, %s, %s, %s, 25.00, 'published', 'General', 'Beginner', 'Coach Pro', TRUE)
                    """,
                    (course_id, instructor_id, f"Equal-priced course {index}", "Revenue aggregation test course."),
                )
        connection.commit()

    for course_id in course_ids:
        for student_id in student_ids:
            assert db.upsert_enrollment(student_id, course_id) is not None

    instructors = client.get("/api/admin/instructors", headers=ADMIN_HEADERS)
    assert instructors.status_code == 200, instructors.text
    row = next(item for item in instructors.json()["data"] if item["id"] == instructor_id)
    assert row["total_courses"] == 2
    assert row["enrolled_students"] == 4
    assert row["total_earnings"] == 100.0


def test_registration_and_auto_publish_settings_are_enforced() -> None:
    previous_settings = db.get_platform_admin_settings()
    try:
        saved = client.put(
            "/api/admin/settings",
            headers=ADMIN_HEADERS,
            json={"allowStudentSignup": False, "autoPublishCourses": True},
        )
        assert saved.status_code == 200, saved.text

        denied_student = client.post(
            "/api/auth/sign-up",
            json={"email": _email(), "password": "SecurePass123", "full_name": "Closed Signup", "role": "student"},
        )
        assert denied_student.status_code == 403, denied_student.text

        instructor = client.post(
            "/api/auth/sign-up",
            json={"email": _email(), "password": "SecurePass123", "full_name": "Auto Publish Instructor", "role": "instructor"},
        )
        assert instructor.status_code == 201, instructor.text
        instructor_user = instructor.json()["data"]["user"]
        instructor_token = instructor.json()["data"]["session"]["access_token"]
        course = client.post(
            "/api/courses",
            headers={"Authorization": f"Bearer {instructor_token}"},
            json={
                "title": "Automatically published course",
                "description": "System setting should override the draft request.",
                "instructor_id": instructor_user["id"],
                "status": "draft",
                "is_published": False,
            },
        )
        assert course.status_code == 201, course.text
        assert course.json()["data"]["status"] == "published"
        assert course.json()["data"]["is_published"] is True
    finally:
        db.save_platform_admin_settings(previous_settings)


def test_jwt_expiration_setting_controls_issued_access_tokens() -> None:
    previous_settings = db.get_platform_admin_settings()
    try:
        response = client.put("/api/admin/settings", headers=ADMIN_HEADERS, json={"jwt_expiration_minutes": 3})
        assert response.status_code == 200, response.text
        token = create_access_token("admin-1", "admin")
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
        assert claims["exp"] - claims["iat"] == 180

        invalid = client.put("/api/admin/settings", headers=ADMIN_HEADERS, json={"jwt_expiration_minutes": 0})
        assert invalid.status_code == 422, invalid.text
    finally:
        db.save_platform_admin_settings(previous_settings)


def test_enforce_mfa_requires_totp_before_issuing_access_token() -> None:
    previous_settings = db.get_platform_admin_settings()
    try:
        saved = client.put("/api/admin/settings", headers=ADMIN_HEADERS, json={"enforce_mfa": True})
        assert saved.status_code == 200, saved.text

        signup = client.post(
            "/api/auth/sign-up",
            json={"email": _email(), "password": "SecurePass123", "full_name": "MFA Enforced User", "role": "student"},
        )
        assert signup.status_code == 201, signup.text
        challenge = signup.json()["data"]
        assert challenge["mfa_setup_required"] is True
        assert "session" not in challenge

        setup = client.post(
            "/api/auth/mfa/setup",
            headers={"Authorization": f"Bearer {challenge['challenge_token']}"},
        )
        assert setup.status_code == 200, setup.text
        secret = setup.json()["data"]["secret"]
        user_id = challenge["user"]["id"]

        access_before_mfa = create_access_token(user_id, "student")
        denied = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access_before_mfa}"})
        assert denied.status_code == 401

        code = pyotp.TOTP(secret).now()
        verified = client.post(
            "/api/auth/mfa/verify",
            headers={"Authorization": f"Bearer {challenge['challenge_token']}"},
            json={"code": code},
        )
        assert verified.status_code == 200, verified.text
        access_token = verified.json()["data"]["session"]["access_token"]
        authenticated = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access_token}"})
        assert authenticated.status_code == 200, authenticated.text

        login = client.post(
            "/api/auth/sign-in",
            json={"email": challenge["user"]["email"], "password": "SecurePass123"},
        )
        assert login.status_code == 200, login.text
        login_challenge = login.json()["data"]
        assert login_challenge["mfa_required"] is True
        reverified = client.post(
            "/api/auth/mfa/verify",
            headers={"Authorization": f"Bearer {login_challenge['challenge_token']}"},
            json={"code": pyotp.TOTP(secret).now()},
        )
        assert reverified.status_code == 200, reverified.text
    finally:
        db.save_platform_admin_settings(previous_settings)


def test_password_reset_updates_hash_and_bulk_notify_inserts_records() -> None:
    email = _email()
    created = client.post(
        "/api/admin/students",
        headers=ADMIN_HEADERS,
        json={"full_name": "Resettable Student", "email": email, "password": "OriginalPass123"},
    )
    student_id = created.json()["data"]["id"]

    reset = client.post(f"/api/admin/students/{student_id}/reset-password", headers=ADMIN_HEADERS)
    assert reset.status_code == 200, reset.text
    temporary_password = reset.json()["data"]["temporary_password"]
    assert len(temporary_password) >= 12
    assert client.post("/api/auth/sign-in", json={"email": email, "password": "OriginalPass123"}).status_code == 401
    assert client.post("/api/auth/sign-in", json={"email": email, "password": temporary_password}).status_code == 200

    notified = client.post(
        "/api/admin/students/bulk-notify",
        headers=ADMIN_HEADERS,
        json={"student_ids": [student_id, student_id, "missing-user"]},
    )
    assert notified.status_code == 200, notified.text
    assert notified.json()["data"]["queued"] == 1
    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM notifications WHERE user_id = %s", (student_id,))
            assert cursor.fetchone()[0] == 2


def test_admin_settings_and_storage_endpoints_persist_and_mask_secrets(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    (upload_root / "videos").mkdir(parents=True)
    (upload_root / "videos" / "test.mp4").write_bytes(b"test-video")
    monkeypatch.setattr(admin_routes, "UPLOAD_ROOT", upload_root)

    saved = client.put(
        "/api/admin/settings",
        headers=ADMIN_HEADERS,
        json={"siteName": "Admin-managed name", "currency": "CAD", "smtp_password": "smtp-secret"},
    )
    assert saved.status_code == 200, saved.text
    loaded = client.get("/api/admin/settings", headers=ADMIN_HEADERS)
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["data"]["siteName"] == "Admin-managed name"
    assert loaded.json()["data"]["currency"] == "CAD"
    assert loaded.json()["data"]["smtp_password"] == ""

    snapshot = client.get("/api/admin/storage", headers=ADMIN_HEADERS)
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["data"]["videos"]["files"] == 1

    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT settings FROM platform_settings WHERE id = 1")
            stored = cursor.fetchone()[0]
    if isinstance(stored, str):
        stored = json.loads(stored)
    assert stored["smtp_password"] == "smtp-secret"


def test_admin_validation_errors_include_field_details() -> None:
    response = client.post(
        "/api/admin/students",
        headers=ADMIN_HEADERS,
        json={"full_name": "Invalid Student", "email": "not-an-email", "password": "short"},
    )
    assert response.status_code == 422
    assert "email" in response.json()["error"]
    assert "password" in response.json()["error"]


def test_only_platform_owner_can_promote_or_change_admin_roles() -> None:
    student = _signup_user()
    created_admins = []
    admin_tokens = []
    for name in ("Secondary Admin One", "Secondary Admin Two"):
        email = _email()
        created = client.post(
            "/api/admin/users",
            headers=ADMIN_HEADERS,
            json={"full_name": name, "email": email, "password": "SecurePass123", "role": "admin"},
        )
        assert created.status_code == 201, created.text
        created_admins.append(created.json()["data"])
        signed_in = client.post("/api/auth/sign-in", json={"email": email, "password": "SecurePass123"})
        assert signed_in.status_code == 200, signed_in.text
        admin_tokens.append(signed_in.json()["data"]["session"]["access_token"])

    secondary_headers = {"Authorization": f"Bearer {admin_tokens[0]}"}
    promote_attempt = client.patch(
        f"/api/admin/users/{student['user']['id']}/role",
        headers=secondary_headers,
        json={"role": "admin"},
    )
    assert promote_attempt.status_code == 403, promote_attempt.text

    demote_attempt = client.patch(
        f"/api/admin/users/{created_admins[1]['id']}/role",
        headers=secondary_headers,
        json={"role": "student"},
    )
    assert demote_attempt.status_code == 403, demote_attempt.text

    owner_promote = client.patch(
        f"/api/admin/users/{student['user']['id']}/role",
        headers=ADMIN_HEADERS,
        json={"role": "admin"},
    )
    assert owner_promote.status_code == 200, owner_promote.text
    assert owner_promote.json()["data"]["role"] == "admin"

    owner_demote = client.patch(
        f"/api/admin/users/{created_admins[1]['id']}/role",
        headers=ADMIN_HEADERS,
        json={"role": "student"},
    )
    assert owner_demote.status_code == 200, owner_demote.text
    assert owner_demote.json()["data"]["role"] == "student"


@pytest.mark.parametrize("account_status", ["inactive", "suspended"])
def test_inactive_and_suspended_users_cannot_login_or_use_authenticated_routes(account_status: str) -> None:
    account = _signup_user()
    user = account["user"]
    access_token = account["session"]["access_token"]
    assert db.update_user_status(user["id"], account_status) is not None

    login = client.post("/api/auth/sign-in", json={"email": user["email"], "password": "SecurePass123"})
    assert login.status_code == 401, login.text

    headers = {"Authorization": f"Bearer {access_token}"}
    profile = client.get("/api/auth/me", headers=headers)
    assert profile.status_code == 401, profile.text
    admin_route = client.get("/api/admin/stats", headers=headers)
    assert admin_route.status_code == 401, admin_route.text