from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app import db
from app.core.security import create_access_token
from app.main import app
from app.services.cleanup_service import resolve_server_storage_path

client = TestClient(app)
ADMIN_HEADERS = {"Authorization": f"Bearer {create_access_token('admin-1', 'admin')}"}


def _auth_headers(user_id: str) -> dict[str, str]:
    user = db.get_user_by_id(user_id)
    assert user is not None
    return {"Authorization": f"Bearer {create_access_token(user_id, user['role'])}"}


def _signup_instructor() -> str:
    response = client.post(
        "/api/auth/sign-up",
        json={
            "email": f"media_{uuid.uuid4().hex}@example.com",
            "password": "Secret123",
            "full_name": "Media Lifecycle Instructor",
            "role": "instructor",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["user"]["id"]


def _write_upload(root: Path, folder: str, filename: str) -> Path:
    directory = root / folder
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / filename
    file_path.write_bytes(b"media-test")
    return file_path


def _course_payload(instructor_id: str, course_id: str, media_url: str, module_id: str, lesson_id: str) -> dict:
    return {
        "id": course_id,
        "instructor_id": instructor_id,
        "title": "Lifecycle course",
        "description": "Course used to verify media cleanup.",
        "thumbnail_url": None,
        "status": "draft",
        "modules": [
            {
                "id": module_id,
                "title": "Module one",
                "lessons": [
                    {
                        "id": lesson_id,
                        "title": "Lesson one",
                        "video_url": media_url,
                        "attachment_url": None,
                    }
                ],
            }
        ],
    }


def test_admin_course_delete_removes_database_rows_and_files(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    course_id = str(uuid.uuid4())
    module_id = str(uuid.uuid4())
    lesson_id = str(uuid.uuid4())
    media_url = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    thumbnail_url = f"/uploads/attachments/{uuid.uuid4().hex}.jpg"
    video_file = _write_upload(upload_root, "videos", Path(media_url).name)
    thumbnail_file = _write_upload(upload_root, "attachments", Path(thumbnail_url).name)

    payload = _course_payload(instructor_id, course_id, media_url, module_id, lesson_id)
    payload["thumbnail_url"] = thumbnail_url
    created = client.post("/api/courses", json=payload, headers=_auth_headers(instructor_id))
    assert created.status_code == 201, created.text

    deleted = client.delete(
        f"/api/admin/courses/{course_id}",
        headers=ADMIN_HEADERS,
    )
    assert deleted.status_code == 200, deleted.text
    assert db.get_course_by_id(course_id) is None
    assert not video_file.exists()
    assert not thumbnail_file.exists()

    with db.get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM course_modules WHERE course_id = %s", (course_id,))
            assert cursor.fetchone()[0] == 0
            cursor.execute("SELECT COUNT(*) FROM lessons WHERE id = %s", (lesson_id,))
            assert cursor.fetchone()[0] == 0


def test_instructor_course_delete_uses_backend_media_cleanup(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    course_id = str(uuid.uuid4())
    media_url = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    media_file = _write_upload(upload_root, "videos", Path(media_url).name)
    created = client.post(
        "/api/courses",
        json=_course_payload(instructor_id, course_id, media_url, str(uuid.uuid4()), str(uuid.uuid4())),
        headers=_auth_headers(instructor_id),
    )
    assert created.status_code == 201, created.text

    deleted = client.delete(
        f"/api/courses/{course_id}",
        headers=_auth_headers(instructor_id),
    )
    assert deleted.status_code == 200, deleted.text
    assert not media_file.exists()


def test_course_update_replaces_media_and_removes_omitted_lessons(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    course_id = str(uuid.uuid4())
    retained_module_id = str(uuid.uuid4())
    removed_module_id = str(uuid.uuid4())
    retained_lesson_id = str(uuid.uuid4())
    removed_lesson_id = str(uuid.uuid4())
    old_thumbnail = f"/uploads/attachments/{uuid.uuid4().hex}.jpg"
    new_thumbnail = f"/uploads/attachments/{uuid.uuid4().hex}.jpg"
    old_video = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    new_video = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    removed_video = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    old_thumbnail_file = _write_upload(upload_root, "attachments", Path(old_thumbnail).name)
    new_thumbnail_file = _write_upload(upload_root, "attachments", Path(new_thumbnail).name)
    old_video_file = _write_upload(upload_root, "videos", Path(old_video).name)
    new_video_file = _write_upload(upload_root, "videos", Path(new_video).name)
    removed_video_file = _write_upload(upload_root, "videos", Path(removed_video).name)

    original = _course_payload(instructor_id, course_id, old_video, retained_module_id, retained_lesson_id)
    original["thumbnail_url"] = old_thumbnail
    original["modules"].append({
        "id": removed_module_id,
        "title": "Removed module",
        "lessons": [{"id": removed_lesson_id, "title": "Removed lesson", "video_url": removed_video}],
    })
    created = client.post("/api/courses", json=original, headers=_auth_headers(instructor_id))
    assert created.status_code == 201, created.text

    updated = client.put(
        f"/api/courses/{course_id}",
        json={
            "title": "Lifecycle course revised",
            "description": "Updated course.",
            "thumbnail_url": new_thumbnail,
            "modules": [{
                "id": retained_module_id,
                "title": "Module one revised",
                "lessons": [{
                    "id": retained_lesson_id,
                    "title": "Lesson one revised",
                    "video_url": new_video,
                }],
            }],
        },
        headers=_auth_headers(instructor_id),
    )
    assert updated.status_code == 200, updated.text
    returned_modules = updated.json()["data"]["modules"]
    assert [module["id"] for module in returned_modules] == [retained_module_id]
    assert [lesson["id"] for lesson in returned_modules[0]["lessons"]] == [retained_lesson_id]
    assert not old_thumbnail_file.exists()
    assert not old_video_file.exists()
    assert not removed_video_file.exists()
    assert new_thumbnail_file.exists()
    assert new_video_file.exists()


def test_course_delete_preserves_media_still_referenced_elsewhere(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    shared_url = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    shared_file = _write_upload(upload_root, "videos", Path(shared_url).name)
    course_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    for course_id in course_ids:
        created = client.post(
            "/api/courses",
            json=_course_payload(instructor_id, course_id, shared_url, str(uuid.uuid4()), str(uuid.uuid4())),
            headers=_auth_headers(instructor_id),
        )
        assert created.status_code == 201, created.text

    for course_id in course_ids:
        deleted = client.delete(
            f"/api/admin/courses/{course_id}",
            headers=ADMIN_HEADERS,
        )
        assert deleted.status_code == 200, deleted.text
        assert shared_file.exists() is (course_id == course_ids[0])


def test_media_cleanup_requires_admin_and_refuses_traversal(tmp_path: Path) -> None:
    denied = client.post("/api/media/delete", json={"entity": {"url": "/uploads/videos/file.mp4"}})
    assert denied.status_code == 401

    instructor_id = _signup_instructor()
    forbidden = client.post(
        "/api/media/delete",
        json={"entity": {"url": "/uploads/videos/file.mp4"}},
        headers=_auth_headers(instructor_id),
    )
    assert forbidden.status_code == 403

    raw_id = client.post(
        "/api/media/delete",
        json={"entity": {"url": "/uploads/videos/file.mp4"}},
        headers={"Authorization": f"Bearer {instructor_id}"},
    )
    assert raw_id.status_code == 401

    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    outside_file = tmp_path / "secret.txt"
    outside_file.write_text("keep", encoding="utf-8")
    assert resolve_server_storage_path("/uploads/../../secret.txt", upload_root) is None
    cleanup = client.post(
        "/api/media/delete",
        json={"entity": {"files": [{"url": "/uploads/../../secret.txt"}]}},
        headers=ADMIN_HEADERS,
    )
    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["data"]["deleted_files"] == []
    assert outside_file.exists()


def test_admin_user_delete_removes_owned_course_media(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    course_id = str(uuid.uuid4())
    media_url = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    media_file = _write_upload(upload_root, "videos", Path(media_url).name)
    created = client.post(
        "/api/courses",
        json=_course_payload(instructor_id, course_id, media_url, str(uuid.uuid4()), str(uuid.uuid4())),
        headers=_auth_headers(instructor_id),
    )
    assert created.status_code == 201, created.text

    deleted = client.delete(
        f"/api/admin/users/{instructor_id}",
        headers=ADMIN_HEADERS,
    )
    assert deleted.status_code == 200, deleted.text
    assert db.get_course_by_id(course_id) is None
    assert not media_file.exists()


def test_admin_orphan_purge_keeps_referenced_files(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(db, "UPLOAD_ROOT", upload_root)
    instructor_id = _signup_instructor()
    course_id = str(uuid.uuid4())
    referenced_url = f"/uploads/videos/{uuid.uuid4().hex}.mp4"
    referenced_file = _write_upload(upload_root, "videos", Path(referenced_url).name)
    orphan_file = _write_upload(upload_root, "attachments", f"{uuid.uuid4().hex}.pdf")
    created = client.post(
        "/api/courses",
        json=_course_payload(instructor_id, course_id, referenced_url, str(uuid.uuid4()), str(uuid.uuid4())),
        headers=_auth_headers(instructor_id),
    )
    assert created.status_code == 201, created.text

    response = client.post("/api/admin/media/purge-orphans", headers=ADMIN_HEADERS)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["deleted_count"] == 1
    assert referenced_file.exists()
    assert not orphan_file.exists()

    deleted = client.delete(f"/api/admin/courses/{course_id}", headers=ADMIN_HEADERS)
    assert deleted.status_code == 200, deleted.text