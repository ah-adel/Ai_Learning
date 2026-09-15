from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from app.core.config import settings

logger = logging.getLogger(__name__)


def resolve_schema_path(source_path: Path | None = None) -> Path:
    base_path = (source_path or Path(__file__)).resolve()
    candidate_roots = [
        base_path.parents[1],
        base_path.parents[2],
    ]

    for root_path in candidate_roots:
        candidate = root_path / "database" / "schema.sql"
        if candidate.exists():
            return candidate

    return candidate_roots[0] / "database" / "schema.sql"


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


def get_connection():
    connection = psycopg2.connect(settings.database_url, connect_timeout=5)
    connection.autocommit = False
    return connection


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
    return value.strip()


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
        connection.commit()

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


def get_all_users() -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC, email ASC")
            rows = cursor.fetchall()
    return [_row_to_user(row) for row in rows]


def _course_payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "instructor_id": row["instructor_id"],
        "title": row["title"],
        "description": row["description"],
        "thumbnail_url": row["thumbnail_url"],
        "price": float(row.get("price") or 0),
        "is_featured": bool(row.get("is_featured", False)),
        "is_published": bool(row["is_published"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "status": row.get("status") or ("published" if row["is_published"] else "draft"),
        "modules": get_course_modules_with_lessons(row["id"]),
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
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM courses WHERE id = %s", (course_id,))
            deleted = cursor.rowcount > 0
        connection.commit()
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


def create_course_record(payload: dict[str, Any]) -> dict[str, Any]:
    created_at = payload.get("created_at") or __import__("datetime").datetime.utcnow().isoformat()
    updated_at = payload.get("updated_at") or created_at
    status, is_published = _normalize_course_status_and_publish_flag(payload)

    course_id = str(payload.get("id") or uuid.uuid4())
    instructor_id = str(payload.get("instructor_id") or payload.get("instructorId") or "")
    title = str(payload.get("title") or "Untitled course").strip() or "Untitled course"
    description = str(payload.get("description") or "Course created in the platform.").strip() or "Course created in the platform."
    thumbnail_url = payload.get("thumbnail_url") or payload.get("thumbnailUrl")
    price = float(payload.get("price") or 0)
    featured = bool(payload.get("is_featured", payload.get("isFeatured", False)))

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO courses (id, instructor_id, title, description, thumbnail_url, price, status, is_featured, is_published, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    instructor_id = EXCLUDED.instructor_id,
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    thumbnail_url = EXCLUDED.thumbnail_url,
                    price = EXCLUDED.price,
                    status = EXCLUDED.status,
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
                    featured,
                    is_published,
                    created_at,
                    updated_at,
                ),
            )

            for module in payload.get("modules") or []:
                module_id = str(module.get("id") or uuid.uuid4())
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

                for lesson in module.get("lessons") or []:
                    lesson_id = str(lesson.get("id") or uuid.uuid4())
                    lesson_title = str(lesson.get("title") or "Lesson").strip() or "Lesson"
                    lesson_content = lesson.get("content")
                    lesson_video_url = lesson.get("video_url") or lesson.get("videoUrl")
                    lesson_attachment_url = lesson.get("attachment_url") or lesson.get("attachmentUrl")
                    lesson_position = int(lesson.get("position") or 0)
                    duration_minutes = lesson.get("duration_minutes") or lesson.get("duration")
                    cursor.execute(
                        """
                        INSERT INTO lessons (
                            id, module_id, title, content, video_url, video_name, attachment_url, attachment_name,
                            position, duration_minutes, created_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            title = EXCLUDED.title,
                            content = EXCLUDED.content,
                            video_url = EXCLUDED.video_url,
                            video_name = EXCLUDED.video_name,
                            attachment_url = EXCLUDED.attachment_url,
                            attachment_name = EXCLUDED.attachment_name,
                            position = EXCLUDED.position,
                            duration_minutes = EXCLUDED.duration_minutes
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
                            created_at,
                        ),
                    )
        connection.commit()

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
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            deleted = cursor.rowcount > 0
        connection.commit()
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
        "specialty": row["specialty"],
        "permissions": permissions_payload,
        "joined_at": row["joined_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
