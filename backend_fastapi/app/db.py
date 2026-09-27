from __future__ import annotations

import json
import hashlib
import hmac
import logging
import os
import secrets
import sys
import uuid
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from app.core.config import settings
from app.services.cleanup_service import collect_candidate_urls, collect_entity_media_paths, purge_files, purge_orphaned_files

logger = logging.getLogger(__name__)
UPLOAD_ROOT = settings.upload_dir

DEFAULT_ADMIN_SETTINGS: dict[str, Any] = {
    "platform_name": "Fasl_ai",
    "support_email": "",
    "currency": "USD",
    "default_language": "en",
    "default_theme": "system",
    "enforce_mfa": False,
    "jwt_expiration_minutes": 60,
    "password_min_length": 8,
    "password_require_uppercase": True,
    "password_require_number": True,
    "password_require_symbol": True,
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_username": "",
    "smtp_password": "",
    "smtp_from_email": "",
    "smtp_use_tls": True,
    "companyName": "Fasl_ai",
    "siteName": "Fasl_ai",
    "timezone": "UTC",
    "allowStudentSignup": True,
    "requireEmailVerification": False,
    "autoPublishCourses": False,
    "performancePlatformReferences": True,
}


class PosixCompatiblePath(type(Path())):
    def __str__(self) -> str:
        return super().__str__().replace('\\', '/')

    def __fspath__(self) -> str:
        return str(self)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, (str, os.PathLike)):
            return str(self) == str(other).replace('\\', '/')
        if hasattr(other, '__fspath__'):
            return str(self) == str(other).replace('\\', '/')
        return super().__eq__(other)

    def __hash__(self) -> int:
        return hash(str(self))


def resolve_schema_path(source_path: Path | None = None) -> Path:
    requested_path = source_path or Path(__file__)
    requested_text = str(requested_path).replace('\\', '/')

    if requested_text.startswith('/app/') or requested_text.startswith('/app'):
        return PosixCompatiblePath('/app/database/schema.sql')

    base_path = requested_path.resolve()
    candidate_roots = [
        base_path.parents[1],
        base_path.parents[2],
        base_path.parent,
    ]

    for root_path in candidate_roots:
        if root_path is None:
            continue
        candidate = root_path / 'database' / 'schema.sql'
        if candidate.exists():
            return candidate

    if requested_path.is_absolute() and requested_text.startswith('D:/'):
        return PosixCompatiblePath('D:/app/database/schema.sql')

    return PosixCompatiblePath(str(base_path.parents[1] / 'database' / 'schema.sql'))


SCHEMA_PATH = resolve_schema_path()


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False

    for character in sql:
        if character == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif character == '"' and not in_single_quote:
            in_double_quote = not in_double_quote

        if character == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            continue

        current.append(character)

    trailing_statement = "".join(current).strip()
    if trailing_statement:
        statements.append(trailing_statement)

    return statements


def _normalize_difficulty(value: Any) -> str:
    if value is None:
        return 'Beginner'

    normalized = str(value).strip()
    if not normalized:
        return 'Beginner'

    lowered = normalized.lower()
    if lowered == 'beginner':
        return 'Beginner'
    if lowered == 'intermediate':
        return 'Intermediate'
    if lowered == 'advanced':
        return 'Advanced'
    return 'Beginner' if normalized not in {'Beginner', 'Intermediate', 'Advanced'} else normalized


def get_connection():
    connection = psycopg2.connect(settings.database_url, connect_timeout=5)
    connection.autocommit = False
    return connection


def _fetch_media_urls(connection, query: str, parameters: tuple[Any, ...] = ()) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(query, parameters)
        return [str(row[0]) for row in cursor.fetchall() if row and row[0]]


def _course_media_urls(connection, course_id: str) -> list[str]:
    return _fetch_media_urls(
        connection,
        """
        SELECT thumbnail_url FROM courses WHERE id = %s
        UNION ALL
        SELECT l.video_url FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = %s
        UNION ALL
        SELECT l.attachment_url FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = %s
        """,
        (course_id, course_id, course_id),
    )


def _user_media_urls(connection, user_id: str) -> list[str]:
    return _fetch_media_urls(
        connection,
        """
        SELECT avatar FROM users WHERE id = %s
        UNION ALL
        SELECT avatar_url FROM profiles WHERE id = %s
        UNION ALL
        SELECT c.thumbnail_url FROM courses c WHERE c.instructor_id = %s
        UNION ALL
        SELECT l.video_url FROM lessons l
        JOIN course_modules m ON m.id = l.module_id
        JOIN courses c ON c.id = m.course_id
        WHERE c.instructor_id = %s
        UNION ALL
        SELECT l.attachment_url FROM lessons l
        JOIN course_modules m ON m.id = l.module_id
        JOIN courses c ON c.id = m.course_id
        WHERE c.instructor_id = %s
        """,
        (user_id, user_id, user_id, user_id, user_id),
    )


def _all_referenced_media_urls(connection) -> list[str]:
    return _fetch_media_urls(
        connection,
        """
        SELECT thumbnail_url FROM courses
        UNION ALL SELECT video_url FROM lessons
        UNION ALL SELECT attachment_url FROM lessons
        UNION ALL SELECT avatar FROM users
        UNION ALL SELECT avatar_url FROM profiles
        """,
    )


def _unreferenced_media_paths(connection, candidate_urls: list[str]) -> list[str]:
    candidates = collect_entity_media_paths(
        {"files": [{"url": url} for url in candidate_urls]},
        project_root=UPLOAD_ROOT,
    )
    referenced = set(collect_entity_media_paths(
        {"files": [{"url": url} for url in _all_referenced_media_urls(connection)]},
        project_root=UPLOAD_ROOT,
    ))
    return [path for path in candidates if path not in referenced]


def _purge_media_paths(paths: list[str]) -> None:
    if not paths:
        return
    deleted, errors = purge_files(paths, upload_root=UPLOAD_ROOT)
    if errors:
        logger.warning("Some unreferenced media files could not be removed: %s", errors)
    if deleted:
        logger.info("Removed %s unreferenced media files", len(deleted))


def purge_orphaned_uploads() -> dict[str, Any]:
    with get_connection() as connection:
        referenced_urls = _all_referenced_media_urls(connection)
    result = purge_orphaned_files(referenced_urls, upload_root=UPLOAD_ROOT)
    return {
        "deleted_count": len(result["deleted_files"]),
        "error_count": len(result["errors"]),
    }


def cleanup_unreferenced_media(entity: dict[str, Any]) -> dict[str, Any]:
    candidate_urls = collect_candidate_urls(entity)
    with get_connection() as connection:
        paths = _unreferenced_media_paths(connection, candidate_urls)
    deleted, errors = purge_files(paths, upload_root=UPLOAD_ROOT)
    return {
        "entityId": entity.get("id") or entity.get("courseId") or entity.get("lessonId"),
        "deletedFiles": deleted,
        "purgedCollections": [],
        "errors": errors,
    }


def initialize_database() -> None:
    try:
        if not SCHEMA_PATH.exists():
            raise FileNotFoundError(f"Database schema file not found: {SCHEMA_PATH}")

        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_lock(hashtext('educational_platform_schema_init'))")
                for statement in _split_sql_statements(schema_sql):
                    cursor.execute(statement)
            connection.commit()
    except (FileNotFoundError, PermissionError, OSError, psycopg2.Error) as exc:
        logger.critical(
            "Database initialization failed. Schema path: %s. Check that the PostgreSQL service is running and schema.sql is present.",
            SCHEMA_PATH,
            exc_info=True,
        )
        raise SystemExit(1) from exc


def _normalize_password(value: str) -> str:
    password = value.strip()
    if password.startswith("pbkdf2_sha256$"):
        return password
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256$310000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_value: str) -> tuple[bool, bool]:
    candidate = password.strip()
    if not stored_value.startswith("pbkdf2_sha256$"):
        return hmac.compare_digest(candidate, stored_value), True

    try:
        algorithm, rounds_text, salt_text, digest_text = stored_value.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False, False
        rounds = int(rounds_text)
        if rounds < 100_000 or rounds > 2_000_000:
            return False, False
        salt = bytes.fromhex(salt_text)
        expected = bytes.fromhex(digest_text)
    except (ValueError, TypeError):
        return False, False

    actual = hashlib.pbkdf2_hmac("sha256", candidate.encode(), salt, rounds)
    return hmac.compare_digest(actual, expected), False


def upgrade_user_password_hash(user_id: str, password: str) -> None:
    encoded = _normalize_password(password)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (encoded, user_id),
            )
        connection.commit()


def _serialize_permissions(value: dict[str, Any] | None) -> str:
    if not isinstance(value, dict):
        value = {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1}
    return json.dumps(value, separators=(",", ":"))


def create_user_record(payload: dict[str, Any]) -> dict[str, Any]:
    user_id = payload["id"]
    name = str(payload["name"]).strip()
    email = str(payload["email"]).strip().lower()
    password = _normalize_password(str(payload["password"]))
    role = str(payload.get("role", "student"))
    avatar = payload.get("avatar")
    status = str(payload.get("status", "active"))
    specialty = payload.get("specialty")
    permissions = payload.get("permissions") or {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1}
    joined_at = payload.get("joined_at") or payload.get("created_at") or __import__("datetime").datetime.utcnow().isoformat()
    created_at = payload.get("created_at") or joined_at
    updated_at = payload.get("updated_at") or created_at

    with get_connection() as connection:
        old_media_urls = _fetch_media_urls(
            connection,
            "SELECT avatar FROM users WHERE id = %s UNION ALL SELECT avatar_url FROM profiles WHERE id = %s",
            (user_id, user_id),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (id, name, email, password, role, avatar, status, specialty, permissions, joined_at, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    password = EXCLUDED.password,
                    role = EXCLUDED.role,
                    avatar = EXCLUDED.avatar,
                    status = EXCLUDED.status,
                    specialty = EXCLUDED.specialty,
                    permissions = EXCLUDED.permissions,
                    joined_at = EXCLUDED.joined_at,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    user_id,
                    name,
                    email,
                    password,
                    role,
                    avatar,
                    status,
                    specialty,
                    _serialize_permissions(permissions),
                    joined_at,
                    created_at,
                    updated_at,
                ),
            )

            cursor.execute(
                """
                INSERT INTO profiles (id, full_name, role, avatar_url, bio, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    role = EXCLUDED.role,
                    avatar_url = EXCLUDED.avatar_url,
                    bio = EXCLUDED.bio,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    user_id,
                    str(payload.get("profile_full_name") or name),
                    role,
                    payload.get("profile_avatar_url"),
                    payload.get("profile_bio"),
                    created_at,
                    updated_at,
                ),
            )
            if role == "instructor":
                cursor.execute(
                    """
                    INSERT INTO instructor_profiles (id, user_id, specialty, status, permissions, joined_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        specialty = EXCLUDED.specialty,
                        status = EXCLUDED.status,
                        permissions = EXCLUDED.permissions,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (user_id, user_id, specialty or "General Instruction", status, _serialize_permissions(permissions), joined_at),
                )
        cleanup_paths = _unreferenced_media_paths(connection, old_media_urls)
        connection.commit()

    _purge_media_paths(cleanup_paths)
    return get_user_by_id(user_id)


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            user_row = cursor.fetchone()
    if not user_row:
        return None
    return _row_to_user(user_row)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
            user_row = cursor.fetchone()
    if not user_row:
        return None
    return _row_to_user(user_row)


def update_user_account(user_id: str, full_name: str, email: str, bio: str | None) -> dict[str, Any] | None:
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET name = %s, email = %s, updated_at = %s WHERE id = %s",
                (full_name, email, now, user_id),
            )
            cursor.execute(
                "UPDATE profiles SET full_name = %s, bio = %s, updated_at = %s WHERE id = %s",
                (full_name, bio, now, user_id),
            )
        connection.commit()
    return get_user_by_id(user_id)


def get_all_users() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC, email ASC")
            rows = cursor.fetchall()
    return [_row_to_user(row) for row in rows]


def get_admin_instructors() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT u.id, u.name, u.email, u.status, u.specialty, u.permissions, u.joined_at,
                       p.full_name, ip.verification_status, ip.is_verified, ip.verification_document_url,
                       ip.payout_status, ip.payout_processed_at,
                       COUNT(DISTINCT c.id) AS total_courses,
                       COUNT(DISTINCT e.id) AS enrolled_students,
                       COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN c.price ELSE 0 END), 0) AS total_earnings
                FROM users u
                JOIN profiles p ON p.id = u.id
                LEFT JOIN instructor_profiles ip ON ip.user_id = u.id
                LEFT JOIN courses c ON c.instructor_id = u.id
                LEFT JOIN enrollments e ON e.course_id = c.id
                WHERE u.role = 'instructor'
                GROUP BY u.id, p.full_name, ip.verification_status, ip.is_verified,
                         ip.verification_document_url, ip.payout_status, ip.payout_processed_at
                ORDER BY u.created_at DESC, u.email ASC
                """
            )
            rows = cursor.fetchall()

    instructors: list[dict[str, Any]] = []
    for row in rows:
        try:
            permissions = json.loads(row.get("permissions") or "{}")
        except (TypeError, json.JSONDecodeError):
            permissions = {}
        earnings = float(row.get("total_earnings") or 0)
        instructors.append({
            "id": row["id"],
            "name": row.get("full_name") or row["name"],
            "email": row["email"],
            "specialty": row.get("specialty") or "General Instruction",
            "status": row.get("status") or "active",
            "verification_status": row.get("verification_status") or "pending",
            "verification_document_url": row.get("verification_document_url"),
            "is_verified": bool(row.get("is_verified", False)),
            "payout_status": row.get("payout_status") or "pending",
            "payout_processed_at": row.get("payout_processed_at"),
            "total_courses": int(row.get("total_courses") or 0),
            "enrolled_students": int(row.get("enrolled_students") or 0),
            "total_earnings": earnings,
            "platform_commission": round(earnings * 0.1, 2),
            "joined_at": row.get("joined_at"),
            "permissions": permissions,
        })
    return instructors


def update_admin_instructor(user_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    instructor = next((row for row in get_admin_instructors() if row["id"] == user_id), None)
    if instructor is None:
        return None

    name = str(values.get("full_name", values.get("name", instructor["name"]))).strip()
    email = str(values.get("email", instructor["email"])).strip().lower()
    specialty = str(values.get("specialty", instructor["specialty"])).strip() or "General Instruction"
    status_value = str(values.get("status", instructor["status"]))
    if status_value not in {"active", "inactive", "suspended"}:
        raise ValueError("Status must be active, inactive, or suspended.")
    permissions = values.get("permissions", instructor["permissions"])
    permissions_json = _serialize_permissions(permissions if isinstance(permissions, dict) else {})
    verification_status = values.get("verification_status", instructor["verification_status"])
    if verification_status not in {"pending", "approved", "rejected"}:
        raise ValueError("Unsupported instructor verification status.")
    payout_status = values.get("payout_status", instructor["payout_status"])
    if payout_status not in {"pending", "paid"}:
        raise ValueError("Unsupported instructor payout status.")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET name = %s, email = %s, specialty = %s, status = %s, permissions = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s AND role = 'instructor'",
                (name, email, specialty, status_value, permissions_json, user_id),
            )
            if cursor.rowcount == 0:
                return None
            cursor.execute(
                "UPDATE profiles SET full_name = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (name, user_id),
            )
            cursor.execute(
                """
                INSERT INTO instructor_profiles (id, user_id, specialty, status, permissions, verification_status,
                    is_verified, payout_status, payout_processed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                    CASE WHEN %s = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END)
                ON CONFLICT (user_id) DO UPDATE SET
                    specialty = EXCLUDED.specialty, status = EXCLUDED.status, permissions = EXCLUDED.permissions,
                    verification_status = EXCLUDED.verification_status, is_verified = EXCLUDED.is_verified,
                    payout_status = EXCLUDED.payout_status,
                    payout_processed_at = CASE WHEN EXCLUDED.payout_status = 'paid'
                        THEN COALESCE(instructor_profiles.payout_processed_at, CURRENT_TIMESTAMP) ELSE NULL END,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, user_id, specialty, status_value, permissions_json, verification_status,
                 bool(values.get("is_verified", instructor["is_verified"])), payout_status, payout_status),
            )
        connection.commit()
    return next((row for row in get_admin_instructors() if row["id"] == user_id), None)


def reassign_instructor_courses(instructor_id: str, course_ids: list[str]) -> bool:
    if not any(row["id"] == instructor_id for row in get_admin_instructors()):
        return False
    selected = list(dict.fromkeys(course_ids))
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM courses WHERE id = ANY(%s::text[])", (selected,))
            found_ids = {row[0] for row in cursor.fetchall()}
            if found_ids != set(selected):
                return False
            cursor.execute(
                "UPDATE courses SET instructor_id = 'admin-1', updated_at = CURRENT_TIMESTAMP WHERE instructor_id = %s AND NOT (id = ANY(%s::text[]))",
                (instructor_id, selected),
            )
            cursor.execute(
                "UPDATE courses SET instructor_id = %s, updated_at = CURRENT_TIMESTAMP WHERE id = ANY(%s::text[])",
                (instructor_id, selected),
            )
        connection.commit()
    return True


def create_admin_notification(user_id: str, title: str, message: str, created_by: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO notifications (id, user_id, title, message, notification_type, created_by) SELECT %s, id, %s, %s, 'admin', %s FROM users WHERE id = %s",
                (str(uuid.uuid4()), title, message, created_by, user_id),
            )
        connection.commit()


def create_bulk_student_notifications(student_ids: list[str], created_by: str) -> int:
    unique_ids = list(dict.fromkeys(student_ids))
    if not unique_ids:
        return 0
    with get_connection() as connection:
        with connection.cursor() as cursor:
            inserted = 0
            for student_id in unique_ids:
                cursor.execute(
                    "INSERT INTO notifications (id, user_id, title, message, notification_type, created_by) SELECT %s, id, 'Platform update', 'You have a new message from the platform administration.', 'admin', %s FROM users WHERE id = %s AND role = 'student'",
                    (str(uuid.uuid4()), created_by, student_id),
                )
                inserted += cursor.rowcount
        connection.commit()
    return inserted


def update_user_password(user_id: str, password: str) -> bool:
    encoded = _normalize_password(password)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE users SET password = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (encoded, user_id))
            changed = cursor.rowcount > 0
        connection.commit()
    return changed


def get_user_mfa_secret(user_id: str, *, pending: bool = False) -> str | None:
    column = "mfa_pending_secret" if pending else "mfa_secret"
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT {column} FROM users WHERE id = %s", (user_id,))
            row = cursor.fetchone()
    return row[0] if row else None


def save_pending_mfa_secret(user_id: str, secret: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET mfa_pending_secret = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s AND status = 'active'",
                (secret, user_id),
            )
            changed = cursor.rowcount > 0
        connection.commit()
    return changed


def enable_user_mfa(user_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = %s AND status = 'active' AND mfa_pending_secret IS NOT NULL",
                (user_id,),
            )
            changed = cursor.rowcount > 0
        connection.commit()
    return changed


def reset_user_mfa_attempts(user_id: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET mfa_failed_attempts = 0, mfa_locked_until = NULL WHERE id = %s",
                (user_id,),
            )
        connection.commit()


def record_failed_mfa_attempt(user_id: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET mfa_failed_attempts = mfa_failed_attempts + 1, mfa_locked_until = CASE WHEN mfa_failed_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE mfa_locked_until END WHERE id = %s",
                (user_id,),
            )
        connection.commit()


def get_user_mfa_lock(user_id: str) -> tuple[int, Any] | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT mfa_failed_attempts, mfa_locked_until FROM users WHERE id = %s", (user_id,))
            row = cursor.fetchone()
    return (int(row[0] or 0), row[1]) if row else None


def get_platform_admin_settings() -> dict[str, Any]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT settings FROM platform_settings WHERE id = 1")
            row = cursor.fetchone()
    stored = row.get("settings") if row else {}
    result = {**DEFAULT_ADMIN_SETTINGS, **(stored if isinstance(stored, dict) else {})}
    result["smtp_password"] = ""
    return result


def save_platform_admin_settings(values: dict[str, Any]) -> dict[str, Any]:
    allowed = set(DEFAULT_ADMIN_SETTINGS)
    updates = {key: value for key, value in values.items() if key in allowed and key != "smtp_password"}
    for key in ("enforce_mfa", "allowStudentSignup", "autoPublishCourses", "requireEmailVerification"):
        if key in updates and not isinstance(updates[key], bool):
            raise ValueError(f"{key} must be a boolean.")
    if "jwt_expiration_minutes" in updates:
        expiration = updates["jwt_expiration_minutes"]
        if isinstance(expiration, bool) or not isinstance(expiration, int) or not 1 <= expiration <= 1440:
            raise ValueError("jwt_expiration_minutes must be an integer between 1 and 1440.")
    if values.get("smtp_password"):
        updates["smtp_password"] = str(values["smtp_password"])
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT settings FROM platform_settings WHERE id = 1")
            row = cursor.fetchone()
        stored = row.get("settings") if row else {}
        merged = {**DEFAULT_ADMIN_SETTINGS, **(stored if isinstance(stored, dict) else {}), **updates}
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO platform_settings (id, settings, updated_at) VALUES (1, %s, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = CURRENT_TIMESTAMP",
                (Json(merged),),
            )
        connection.commit()
    merged["smtp_password"] = ""
    return merged


def get_course_reviews(course_id: str) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT cr.id, cr.course_id, cr.student_id, cr.rating, cr.comment, cr.created_at, p.full_name AS user_name
                FROM course_reviews cr
                LEFT JOIN profiles p ON p.id = cr.student_id
                WHERE cr.course_id = %s
                ORDER BY cr.created_at DESC
                """,
                (course_id,),
            )
            rows = cursor.fetchall()

    return [
        {
            "id": row["id"],
            "course_id": row["course_id"],
            "student_id": row["student_id"],
            "user_id": row["student_id"],
            "user_name": row.get("user_name") or "Student",
            "userName": row.get("user_name") or "Student",
            "rating": int(row["rating"]),
            "comment": row["comment"],
            "created_at": row["created_at"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def get_course_review_stats(course_id: str) -> dict[str, Any]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS review_count, COALESCE(AVG(rating), 0) AS average_rating
                FROM course_reviews
                WHERE course_id = %s
                """,
                (course_id,),
            )
            stats = cursor.fetchone() or {}

    review_count = int(stats.get("review_count") or 0)
    average_rating = float(stats.get("average_rating") or 0)
    return {
        "review_count": review_count,
        "average_rating": round(average_rating, 1),
        "reviews": get_course_reviews(course_id),
    }


def get_course_enrollment_count(course_id: str) -> int:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM enrollments WHERE course_id = %s", (course_id,))
            count = cursor.fetchone()
    return int(count[0] if count else 0)


def _course_payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    course_id = row["id"]
    review_stats = get_course_review_stats(course_id)
    return {
        "id": course_id,
        "instructor_id": row["instructor_id"],
        "title": row["title"],
        "description": row["description"],
        "thumbnail_url": row["thumbnail_url"],
        "price": float(row.get("price") or 0),
        "category": row.get("category") or "General",
        "difficulty": _normalize_difficulty(row.get("difficulty")),
        "ai_model": row.get("ai_model") or "Coach Pro",
        "is_featured": bool(row.get("is_featured", False)),
        "is_published": bool(row["is_published"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "status": row.get("status") or ("published" if row["is_published"] else "draft"),
        "modules": get_course_modules_with_lessons(course_id),
        "reviews": review_stats["reviews"],
        "review_count": review_stats["review_count"],
        "average_rating": review_stats["average_rating"],
        "enrollment_count": get_course_enrollment_count(course_id),
    }


def get_course_modules_with_lessons(course_id: str) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT *
                FROM course_modules
                WHERE course_id = %s
                ORDER BY position ASC, created_at ASC
                """,
                (course_id,),
            )
            module_rows = cursor.fetchall()

    modules: list[dict[str, Any]] = []
    for module_row in module_rows:
        with get_connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT *
                    FROM lessons
                    WHERE module_id = %s
                    ORDER BY position ASC, created_at ASC
                    """,
                    (module_row["id"],),
                )
                lesson_rows = cursor.fetchall()

        modules.append({
            "id": module_row["id"],
            "course_id": module_row["course_id"],
            "title": module_row["title"],
            "position": module_row["position"],
            "created_at": module_row["created_at"],
            "lessons": [
                {
                    "id": lesson_row["id"],
                    "module_id": lesson_row["module_id"],
                    "title": lesson_row["title"],
                    "content": lesson_row["content"],
                    "video_url": lesson_row["video_url"],
                    "video_name": lesson_row["video_name"],
                    "attachment_url": lesson_row["attachment_url"],
                    "attachment_name": lesson_row["attachment_name"],
                    "position": lesson_row["position"],
                    "duration_minutes": lesson_row["duration_minutes"],
                    "duration_seconds": lesson_row.get("duration_seconds"),
                    "created_at": lesson_row["created_at"],
                }
                for lesson_row in lesson_rows
            ],
        })

    return modules


def get_all_courses() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT *
                FROM courses
                ORDER BY created_at DESC, title ASC
                """
            )
            rows = cursor.fetchall()

    return [_course_payload_from_row(row) for row in rows]


def get_public_courses() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT *
                FROM courses
                WHERE is_published = TRUE
                ORDER BY created_at DESC, title ASC
                """
            )
            rows = cursor.fetchall()

    return [_course_payload_from_row(row) for row in rows]


def get_public_platform_stats() -> dict[str, int | float | None]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT
                    (SELECT COUNT(*)
                     FROM users
                     WHERE role = 'student' AND status = 'active') AS active_learners,
                    (SELECT ROUND(
                                COUNT(*) FILTER (WHERE e.completed_at IS NOT NULL)::numeric * 100
                                / NULLIF(COUNT(*), 0),
                                1
                            )
                     FROM enrollments e
                     INNER JOIN courses c ON c.id = e.course_id
                     WHERE c.is_published = TRUE) AS course_completion_rate,
                    (SELECT ROUND(AVG(r.rating)::numeric, 1)
                     FROM course_reviews r
                     INNER JOIN courses c ON c.id = r.course_id
                     WHERE c.is_published = TRUE) AS average_satisfaction
                """
            )
            row = cursor.fetchone() or {}

    completion_rate = row.get("course_completion_rate")
    average_satisfaction = row.get("average_satisfaction")
    return {
        "active_learners": int(row.get("active_learners") or 0),
        "course_completion_rate": float(completion_rate) if completion_rate is not None else None,
        "average_satisfaction": float(average_satisfaction) if average_satisfaction is not None else None,
    }


def get_courses_for_instructor(instructor_id: str) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT *
                FROM courses
                WHERE instructor_id = %s
                ORDER BY created_at DESC, title ASC
                """,
                (instructor_id,),
            )
            rows = cursor.fetchall()

    return [_course_payload_from_row(row) for row in rows]


def get_student_enrolled_courses(student_id: str) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT c.*
                FROM enrollments e
                INNER JOIN courses c ON c.id = e.course_id
                WHERE e.student_id = %s
                ORDER BY e.enrolled_at DESC, c.created_at DESC
                """,
                (student_id,),
            )
            rows = cursor.fetchall()

    return [_course_payload_from_row(row) for row in rows]


def is_student_enrolled(student_id: str, course_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM enrollments WHERE student_id = %s AND course_id = %s LIMIT 1",
                (student_id, course_id),
            )
            return cursor.fetchone() is not None


def get_student_enrollments(student_id: str) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT e.*, c.title AS course_title, c.is_published, c.instructor_id
                FROM enrollments e
                INNER JOIN courses c ON c.id = e.course_id
                WHERE e.student_id = %s
                ORDER BY e.enrolled_at DESC
                """,
                (student_id,),
            )
            rows = cursor.fetchall()

    return [
        {
            "id": row["id"],
            "student_id": row["student_id"],
            "course_id": row["course_id"],
            "enrolled_at": row["enrolled_at"],
            "completed_at": row["completed_at"],
            "course_title": row["course_title"],
            "is_published": bool(row["is_published"]),
            "instructor_id": row["instructor_id"],
        }
        for row in rows
    ]


def upsert_enrollment(student_id: str, course_id: str) -> dict[str, Any] | None:
    course = get_course_by_id(course_id)
    if course is None:
        return None

    enrollment_id = f"{student_id}:{course_id}"
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                INSERT INTO enrollments (id, student_id, course_id, enrolled_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (student_id, course_id) DO NOTHING
                """,
                (enrollment_id, student_id, course_id),
            )
            cursor.execute(
                """
                SELECT *
                FROM enrollments
                WHERE student_id = %s AND course_id = %s
                """,
                (student_id, course_id),
            )
            row = cursor.fetchone()
        connection.commit()

    if row is None:
        return None

    return {
        "id": row["id"],
        "student_id": row["student_id"],
        "course_id": row["course_id"],
        "enrolled_at": row["enrolled_at"],
        "completed_at": row["completed_at"],
    }


def create_course_review(student_id: str, course_id: str, rating: int, comment: str) -> dict[str, Any] | None:
    if not is_student_enrolled(student_id, course_id):
        return None

    cleaned_comment = str(comment or "").strip()
    if not cleaned_comment:
        return None

    normalized_rating = max(1, min(5, int(rating or 5)))
    review_id = f"{student_id}:{course_id}"

    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                INSERT INTO course_reviews (id, course_id, student_id, rating, comment, created_at)
                VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (course_id, student_id) DO UPDATE SET
                    rating = EXCLUDED.rating,
                    comment = EXCLUDED.comment,
                    created_at = CURRENT_TIMESTAMP
                RETURNING *
                """,
                (review_id, course_id, student_id, normalized_rating, cleaned_comment),
            )
            row = cursor.fetchone()
        connection.commit()

    if row is None:
        return None

    profile = get_user_by_id(student_id)
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "student_id": row["student_id"],
        "user_id": row["student_id"],
        "user_name": (profile or {}).get("name") or "Student",
        "userName": (profile or {}).get("name") or "Student",
        "rating": int(row["rating"]),
        "comment": row["comment"],
        "created_at": row["created_at"],
        "createdAt": row["created_at"],
    }


def delete_enrollment(student_id: str, course_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM enrollments WHERE student_id = %s AND course_id = %s",
                (student_id, course_id),
            )
            deleted = cursor.rowcount > 0
        connection.commit()
    return deleted


def delete_course_record(course_id: str) -> bool:
    with get_connection() as connection:
        media_urls = _course_media_urls(connection, course_id)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM courses WHERE id = %s", (course_id,))
            deleted = cursor.rowcount > 0
        if deleted:
            media_paths = _unreferenced_media_paths(connection, media_urls)
        else:
            media_paths = []
    _purge_media_paths(media_paths)
    return deleted


def get_admin_course_inspector(course_id: str) -> dict[str, Any] | None:
    course = get_course_by_id(course_id)
    if course is None:
        return None

    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS enrollment_count,
                       COUNT(*) FILTER (WHERE e.completed_at IS NOT NULL) AS completed_count,
                       COALESCE(SUM(c.price), 0) AS revenue
                FROM enrollments e
                INNER JOIN courses c ON c.id = e.course_id
                WHERE e.course_id = %s
                """,
                (course_id,),
            )
            stats = cursor.fetchone() or {}
            cursor.execute("SELECT id, full_name, avatar_url FROM profiles WHERE id = %s", (course["instructor_id"],))
            instructor = cursor.fetchone()

    return {
        "course": course,
        "instructor": dict(instructor) if instructor else None,
        "stats": {
            "enrollment_count": int(stats.get("enrollment_count") or 0),
            "completed_count": int(stats.get("completed_count") or 0),
            "revenue": float(stats.get("revenue") or 0),
        },
    }


def _normalize_course_status_and_publish_flag(payload: dict[str, Any]) -> tuple[str, bool]:
    raw_status = str(payload.get("status") or "").strip().lower()
    explicit_publish = payload.get("is_published")

    if raw_status in {"published", "approved"}:
        return "published", True
    if raw_status in {"draft", "review", "archived", "rejected"}:
        return raw_status, False
    if explicit_publish is not None:
        return ("published" if bool(explicit_publish) else "draft"), bool(explicit_publish)
    return "draft", False


def _course_payload_media_urls(payload: dict[str, Any]) -> list[str]:
    urls = [payload.get("thumbnail_url") or payload.get("thumbnailUrl")]
    for module in payload.get("modules") or []:
        for lesson in module.get("lessons") or []:
            urls.extend([
                lesson.get("video_url") or lesson.get("videoUrl"),
                lesson.get("attachment_url") or lesson.get("attachmentUrl"),
            ])
    return [str(url) for url in urls if url]


def create_course_record(payload: dict[str, Any]) -> dict[str, Any]:
    created_at = payload.get("created_at") or __import__("datetime").datetime.utcnow().isoformat()
    updated_at = payload.get("updated_at") or created_at
    status, is_published = _normalize_course_status_and_publish_flag(payload)

    course_id = str(payload.get("id") or uuid.uuid4())
    instructor_id = str(payload.get("instructor_id") or payload.get("instructorId") or "")
    title = str(payload.get("title") or "Untitled course").strip() or "Untitled course"
    description = str(payload.get("description") or "Course created in the platform.").strip() or "Course created in the platform."
    thumbnail_url = payload.get("thumbnail_url") or payload.get("thumbnailUrl")
    category = str(payload.get("category") or "General").strip() or "General"
    difficulty = _normalize_difficulty(payload.get("difficulty"))
    ai_model = str(payload.get("ai_model") or payload.get("aiModel") or "Coach Pro").strip() or "Coach Pro"
    price = float(payload.get("price") or 0)
    featured = bool(payload.get("is_featured", payload.get("isFeatured", False)))
    modules = []
    for module in payload.get("modules") or []:
        normalized_module = dict(module)
        normalized_module["id"] = str(module.get("id") or uuid.uuid4())
        normalized_module["lessons"] = []
        for lesson in module.get("lessons") or []:
            normalized_lesson = dict(lesson)
            normalized_lesson["id"] = str(lesson.get("id") or uuid.uuid4())
            normalized_module["lessons"].append(normalized_lesson)
        modules.append(normalized_module)
    payload_media_urls = _course_payload_media_urls({**payload, "modules": modules})

    with get_connection() as connection:
        old_media_urls = _course_media_urls(connection, course_id)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO courses (id, instructor_id, title, description, thumbnail_url, price, status, category, difficulty, ai_model, is_featured, is_published, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    instructor_id = EXCLUDED.instructor_id,
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    thumbnail_url = EXCLUDED.thumbnail_url,
                    price = EXCLUDED.price,
                    status = EXCLUDED.status,
                    category = EXCLUDED.category,
                    difficulty = EXCLUDED.difficulty,
                    ai_model = EXCLUDED.ai_model,
                    is_featured = EXCLUDED.is_featured,
                    is_published = EXCLUDED.is_published,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    course_id,
                    instructor_id,
                    title,
                    description,
                    thumbnail_url,
                    price,
                    status,
                    category,
                    difficulty,
                    ai_model,
                    featured,
                    is_published,
                    created_at,
                    updated_at,
                ),
            )

            module_ids: list[str] = []
            lesson_ids: list[str] = []
            for module in modules:
                module_id = module["id"]
                module_ids.append(module_id)
                module_title = str(module.get("title") or "Module").strip() or "Module"
                module_position = int(module.get("position") or 0)
                cursor.execute(
                    """
                    INSERT INTO course_modules (id, course_id, title, position, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        position = EXCLUDED.position,
                        course_id = EXCLUDED.course_id
                    """,
                    (module_id, course_id, module_title, module_position, created_at),
                )

                for lesson in module["lessons"]:
                    lesson_id = lesson["id"]
                    lesson_ids.append(lesson_id)
                    lesson_title = str(lesson.get("title") or "Lesson").strip() or "Lesson"
                    lesson_content = lesson.get("content")
                    lesson_video_url = lesson.get("video_url") or lesson.get("videoUrl")
                    lesson_attachment_url = lesson.get("attachment_url") or lesson.get("attachmentUrl")
                    lesson_position = int(lesson.get("position") or 0)
                    duration_seconds = lesson.get("duration_seconds")
                    duration_minutes = lesson.get("duration_minutes")
                    if duration_seconds is None and duration_minutes is not None:
                        duration_seconds = int(duration_minutes) * 60
                    cursor.execute(
                        """
                        INSERT INTO lessons (
                            id, module_id, title, content, video_url, video_name, attachment_url, attachment_name,
                            position, duration_minutes, duration_seconds, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            module_id = EXCLUDED.module_id,
                            title = EXCLUDED.title,
                            content = EXCLUDED.content,
                            video_url = EXCLUDED.video_url,
                            video_name = EXCLUDED.video_name,
                            attachment_url = EXCLUDED.attachment_url,
                            attachment_name = EXCLUDED.attachment_name,
                            position = EXCLUDED.position,
                            duration_minutes = EXCLUDED.duration_minutes,
                            duration_seconds = EXCLUDED.duration_seconds
                        """,
                        (
                            lesson_id,
                            module_id,
                            lesson_title,
                            lesson_content,
                            lesson_video_url,
                            lesson.get("video_name") or lesson.get("videoName"),
                            lesson_attachment_url,
                            lesson.get("attachment_name") or lesson.get("attachmentName"),
                            lesson_position,
                            duration_minutes,
                            duration_seconds,
                            created_at,
                        ),
                    )

            cursor.execute(
                "DELETE FROM lessons WHERE module_id IN (SELECT id FROM course_modules WHERE course_id = %s) AND NOT (id = ANY(%s::text[]))",
                (course_id, lesson_ids),
            )
            cursor.execute(
                "DELETE FROM course_modules WHERE course_id = %s AND NOT (id = ANY(%s::text[]))",
                (course_id, module_ids),
            )
        cleanup_paths = _unreferenced_media_paths(connection, old_media_urls)

    _purge_media_paths(cleanup_paths)

    return get_course_by_id(course_id) or {
        "id": course_id,
        "instructor_id": instructor_id,
        "title": title,
        "description": description,
        "thumbnail_url": thumbnail_url,
        "price": price,
        "is_featured": featured,
        "is_published": is_published,
        "created_at": created_at,
        "updated_at": updated_at,
        "status": "published" if is_published else "draft",
        "modules": [],
    }


def get_course_by_id(course_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM courses WHERE id = %s", (course_id,))
            row = cursor.fetchone()

    if row is None:
        return None
    return _course_payload_from_row(row)


def get_admin_stats() -> dict[str, int]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM users) AS total_users,
                    (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active') AS total_students,
                    (SELECT COUNT(*) FROM users WHERE role = 'instructor' AND status = 'active') AS total_instructors,
                    (SELECT COUNT(*) FROM courses) AS total_courses,
                    (SELECT COUNT(*) FROM courses WHERE is_published = TRUE) AS published_courses,
                    (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
                    (SELECT COALESCE(SUM(0), 0) FROM enrollments) AS total_revenue
                """
            )
            stats = cursor.fetchone()

    if stats is None:
        return {
            "total_users": 0,
            "total_students": 0,
            "total_instructors": 0,
            "total_courses": 0,
            "published_courses": 0,
            "total_enrollments": 0,
            "total_revenue": 0,
        }

    return {
        "total_users": int(stats["total_users"] or 0),
        "total_students": int(stats["total_students"] or 0),
        "total_instructors": int(stats["total_instructors"] or 0),
        "total_courses": int(stats["total_courses"] or 0),
        "published_courses": int(stats["published_courses"] or 0),
        "total_enrollments": int(stats["total_enrollments"] or 0),
        "total_revenue": float(stats["total_revenue"] or 0),
    }


def get_admin_activity(limit: int = 20) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT id, 'user' AS event_type, name AS subject, role AS detail, created_at AS occurred_at
                FROM users
                UNION ALL
                SELECT id, 'course' AS event_type, title AS subject,
                       CASE WHEN is_published THEN 'published' ELSE 'draft' END AS detail,
                       created_at AS occurred_at
                FROM courses
                UNION ALL
                SELECT id, 'enrollment' AS event_type, course_id AS subject, student_id AS detail, enrolled_at AS occurred_at
                FROM enrollments
                ORDER BY occurred_at DESC
                LIMIT %s
                """,
                (max(1, min(limit, 100)),),
            )
            rows = cursor.fetchall()

    return [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "subject": row["subject"],
            "detail": row["detail"],
            "occurred_at": row["occurred_at"],
        }
        for row in rows
    ]


def get_admin_students(search: str = "", status_filter: str = "all", sort_by: str = "created_at", descending: bool = True, page: int = 1, page_size: int = 25) -> dict[str, Any]:
    allowed_sort = {"created_at": "u.created_at", "name": "u.name", "email": "u.email", "status": "u.status"}
    order_column = allowed_sort.get(sort_by, "u.created_at")
    offset = max(page - 1, 0) * max(min(page_size, 100), 1)
    direction = "DESC" if descending else "ASC"
    pattern = f"%{search.strip()}%"
    status_clause = "AND u.status = %s" if status_filter in {"active", "inactive", "suspended"} else ""
    params: list[Any] = [pattern, pattern]
    if status_clause:
        params.append(status_filter)

    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(f"""
                SELECT u.id, u.name, u.email, u.status, u.created_at,
                       COUNT(e.id) AS course_count,
                       COALESCE(ROUND(AVG(CASE WHEN sp.is_completed THEN 100 ELSE 0 END)), 0) AS progress
                FROM users u
                LEFT JOIN enrollments e ON e.student_id = u.id
                LEFT JOIN student_progress sp ON sp.student_id = u.id
                WHERE u.role = 'student' AND (u.name ILIKE %s OR u.email ILIKE %s) {status_clause}
                GROUP BY u.id
                ORDER BY {order_column} {direction}
                LIMIT %s OFFSET %s
            """, (*params, max(min(page_size, 100), 1), offset))
            rows = cursor.fetchall()
            count_params: list[Any] = [pattern, pattern]
            if status_clause:
                count_params.append(status_filter)
            cursor.execute(f"SELECT COUNT(*) AS total FROM users u WHERE u.role = 'student' AND (u.name ILIKE %s OR u.email ILIKE %s) {status_clause}", tuple(count_params))
            total = int(cursor.fetchone()["total"])

    return {"items": [dict(row) for row in rows], "total": total, "page": page, "page_size": page_size}


def get_student_inspector(student_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT id, name, email, status, created_at FROM users WHERE id = %s AND role = 'student'", (student_id,))
            student = cursor.fetchone()
            if student is None:
                return None
            cursor.execute("SELECT COUNT(*) AS total, COALESCE(ROUND(AVG(CASE WHEN e.completed_at IS NOT NULL THEN 100 ELSE 0 END)), 0) AS progress FROM enrollments e WHERE e.student_id = %s", (student_id,))
            aggregate = cursor.fetchone()
            cursor.execute("SELECT e.id, e.course_id, c.title, e.enrolled_at, e.completed_at FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = %s ORDER BY e.enrolled_at DESC", (student_id,))
            enrollments = [dict(row) for row in cursor.fetchall()]
    return {"student": dict(student), "total_enrolled_courses": int(aggregate["total"]), "progress": float(aggregate["progress"]), "platform_time_minutes": 0, "completion_certificates": sum(1 for item in enrollments if item["completed_at"]), "enrollments": enrollments, "audit_log": []}


def force_student_enrollment(student_id: str, course_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO enrollments (id, student_id, course_id) VALUES (%s, %s, %s) ON CONFLICT (student_id, course_id) DO NOTHING", (f"{student_id}:{course_id}", student_id, course_id))
            changed = cursor.rowcount > 0
        connection.commit()
    return changed


def get_admin_monthly_activity() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT TO_CHAR(months.month, 'Mon YYYY') AS month,
                       COUNT(e.id) AS enrollments,
                       COALESCE(SUM(0), 0) AS revenue
                FROM generate_series(
                    DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
                    DATE_TRUNC('month', CURRENT_DATE),
                    INTERVAL '1 month'
                ) AS months(month)
                LEFT JOIN enrollments e ON DATE_TRUNC('month', e.enrolled_at) = months.month
                GROUP BY months.month
                ORDER BY months.month ASC
                """
            )
            rows = cursor.fetchall()

    return [
        {"month": row["month"], "enrollments": int(row["enrollments"] or 0), "revenue": float(row["revenue"] or 0)}
        for row in rows
    ]


def update_user_role(user_id: str, role: str) -> dict[str, Any] | None:
    normalized = role.strip().lower()
    if normalized not in {"student", "instructor", "admin"}:
        raise ValueError("Role must be student, instructor, or admin.")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE users SET role = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (normalized, user_id))
            if cursor.rowcount == 0:
                return None
            cursor.execute("UPDATE profiles SET role = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (normalized, user_id))
        connection.commit()
    return get_user_by_id(user_id)


def update_user_status(user_id: str, status: str) -> dict[str, Any] | None:
    normalized = status.strip().lower()
    if normalized not in {"active", "inactive", "suspended"}:
        raise ValueError("Status must be active, inactive, or suspended.")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE users SET status = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (normalized, user_id))
            if cursor.rowcount == 0:
                return None
        connection.commit()
    return get_user_by_id(user_id)


def update_course_status(course_id: str, status: str) -> dict[str, Any] | None:
    normalized = status.strip().lower()
    if normalized == "approved":
        normalized = "published"
    if normalized not in {"draft", "published", "review", "archived", "rejected"}:
        raise ValueError("Unsupported course status.")
    publish_flag = normalized == "published"

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE courses SET status = %s, is_published = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (normalized, publish_flag, course_id))
            if cursor.rowcount == 0:
                return None
        connection.commit()

    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM courses WHERE id = %s", (course_id,))
            row = cursor.fetchone()
    if row is None:
        return None
    return _course_payload_from_row(row)


def update_course_admin_fields(course_id: str, instructor_id: str | None = None, is_featured: bool | None = None) -> dict[str, Any] | None:
    updates: list[str] = []
    values: list[Any] = []
    if instructor_id is not None:
        updates.append("instructor_id = %s")
        values.append(instructor_id)
    if is_featured is not None:
        updates.append("is_featured = %s")
        values.append(is_featured)
    if not updates:
        return get_course_by_id(course_id)

    values.append(course_id)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"UPDATE courses SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = %s", values)
            if cursor.rowcount == 0:
                return None
        connection.commit()
    return get_course_by_id(course_id)


def delete_user_by_id(user_id: str) -> bool:
    with get_connection() as connection:
        media_urls = _user_media_urls(connection, user_id)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            deleted = cursor.rowcount > 0
        if deleted:
            media_paths = _unreferenced_media_paths(connection, media_urls)
        else:
            media_paths = []
    _purge_media_paths(media_paths)
    return deleted


def get_profile_by_user_id(user_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM profiles WHERE id = %s", (user_id,))
            profile_row = cursor.fetchone()
    if not profile_row:
        return None
    return dict(profile_row)


def _row_to_user(row: dict[str, Any]) -> dict[str, Any]:
    permissions = row.get("permissions")
    try:
        permissions_payload = json.loads(permissions) if permissions else {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1}
    except (TypeError, json.JSONDecodeError):
        permissions_payload = {"manage_courses": 1, "moderate_students": 1, "view_analytics": 1}

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "password": row["password"],
        "role": row["role"],
        "avatar": row["avatar"],
        "status": row["status"],
        "mfa_enabled": bool(row.get("mfa_enabled", False)),
        "specialty": row["specialty"],
        "permissions": permissions_payload,
        "joined_at": row["joined_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
