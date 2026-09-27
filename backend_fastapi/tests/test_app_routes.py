from pathlib import Path
import time
import uuid

import jwt
from fastapi.testclient import TestClient

from app import db
from app import main
from app.core.config import settings
from app.core.security import create_access_token
from app.main import app

client = TestClient(app)


def test_schema_path_is_resolved_from_the_app_root() -> None:
    resolved = db.resolve_schema_path(Path('/app/app/db.py'))
    assert resolved == Path('/app/database/schema.sql')
    assert str(resolved).startswith('/app/')
    assert not str(resolved).startswith('/database/')


def test_course_creation_preserves_explicit_difficulty_and_reviews() -> None:
    instructor_email = f"difficulty_{uuid.uuid4().hex[:8]}@example.com"
    instructor = client.post(
        '/api/auth/sign-up',
        json={
            'email': instructor_email,
            'password': 'Secret123',
            'full_name': 'Difficulty Instructor',
            'role': 'instructor',
        },
    )
    assert instructor.status_code == 201, instructor.text
    instructor_id = instructor.json()['data']['user']['id']
    instructor_token = instructor.json()['data']['session']['access_token']

    student_email = f"difficulty_student_{uuid.uuid4().hex[:8]}@example.com"
    student = client.post(
        '/api/auth/sign-up',
        json={
            'email': student_email,
            'password': 'Secret123',
            'full_name': 'Difficulty Student',
            'role': 'student',
        },
    )
    assert student.status_code == 201, student.text
    student_id = student.json()['data']['user']['id']
    student_token = student.json()['data']['session']['access_token']

    payload = {
        'instructor_id': instructor_id,
        'title': 'Advanced Difficulty Course',
        'description': 'This course should persist as Advanced difficulty and collect reviews.',
        'difficulty': 'Advanced',
        'status': 'published',
        'is_published': True,
        'modules': [
            {'title': 'Module 1', 'lessons': [{'title': 'Lesson 1', 'content': 'Intro', 'video_url': 'https://example.com/video.mp4'}]}
        ],
    }

    created = client.post('/api/courses', json=payload, headers={'Authorization': f'Bearer {instructor_token}'})
    assert created.status_code == 201, created.text
    created_course = created.json()['data']
    assert created_course['difficulty'] == 'Advanced', created_course

    enrollment = client.post(f"/api/courses/{created_course['id']}/enroll", headers={'Authorization': f'Bearer {student_token}'})
    assert enrollment.status_code == 200, enrollment.text

    review = client.post(
        f"/api/courses/{created_course['id']}/reviews",
        json={'rating': 5, 'comment': 'Excellent course.'},
        headers={'Authorization': f'Bearer {student_token}'},
    )
    assert review.status_code == 200, review.text

    fetched = client.get(f"/api/courses/{created_course['id']}", headers={'Authorization': f'Bearer {instructor_token}'})
    assert fetched.status_code == 200, fetched.text
    fetched_course = fetched.json()['data']
    assert fetched_course['difficulty'] == 'Advanced', fetched_course
    assert fetched_course['review_count'] >= 1, fetched_course
    assert any(review_item['comment'] == 'Excellent course.' for review_item in fetched_course['reviews']), fetched_course


def test_health_endpoint_returns_ok() -> None:
    response = client.get('/health')
    assert response.status_code == 200
    payload = response.json()
    assert payload['success'] is True
    assert payload['data']['status'] == 'ok'


def test_public_platform_stats_returns_aggregate_values() -> None:
    response = client.get('/api/platform/stats')

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['success'] is True
    stats = payload['data']
    assert isinstance(stats['active_learners'], int)
    assert stats['course_completion_rate'] is None or isinstance(stats['course_completion_rate'], (int, float))
    assert stats['average_satisfaction'] is None or isinstance(stats['average_satisfaction'], (int, float))


def test_media_upload_returns_url() -> None:
    response = client.post(
        '/api/media/upload',
        files={'file': ('demo.txt', b'hello world', 'text/plain')},
        data={'type': 'attachment'},
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload['success'] is True
    assert payload['data']['url'].startswith('/uploads/attachments/')


def test_video_stream_supports_http_ranges(tmp_path, monkeypatch) -> None:
    video_root = tmp_path / 'videos'
    video_root.mkdir()
    video_path = video_root / 'sample.mp4'
    content = bytes(range(256)) * 4
    video_path.write_bytes(content)
    monkeypatch.setattr(main, 'UPLOAD_STATIC_DIR', tmp_path)

    response = client.get('/uploads/videos/sample.mp4', headers={'Range': 'bytes=100-199'})

    assert response.status_code == 206
    assert response.headers['accept-ranges'] == 'bytes'
    assert response.headers['content-range'] == 'bytes 100-199/1024'
    assert response.headers['content-length'] == '100'
    assert response.content == content[100:200]


def test_auth_sign_up_and_sign_in_persist_in_sqlite() -> None:
    email = f'persisted.user.{uuid.uuid4().hex}@example.com'
    sign_up = client.post(
        '/api/auth/sign-up',
        json={
            'email': email,
            'password': 'Secret123',
            'full_name': 'Persisted User',
            'role': 'student',
        },
    )
    assert sign_up.status_code == 201, sign_up.text
    body = sign_up.json()
    assert body['success'] is True
    assert body['data']['user']['email'] == email.lower()

    sign_in = client.post(
        '/api/auth/sign-in',
        json={'email': email, 'password': 'Secret123'},
    )
    assert sign_in.status_code == 200, sign_in.text
    payload = sign_in.json()
    assert payload['success'] is True
    assert payload['data']['user']['email'] == email.lower()
    access_token = payload['data']['session']['access_token']

    me = client.get('/api/auth/me', headers={'Authorization': f'Bearer {access_token}'})
    assert me.status_code == 200, me.text
    profile_payload = me.json()
    assert profile_payload['success'] is True
    assert profile_payload['data']['profile']['full_name'] == 'Persisted User'


def test_signed_jwt_authentication_rejects_raw_tampered_expired_and_wrong_role_tokens() -> None:
    email = f'jwt.user.{uuid.uuid4().hex}@example.com'
    signup = client.post(
        '/api/auth/sign-up',
        json={'email': email, 'password': 'Secret123', 'full_name': 'JWT User', 'role': 'student'},
    )
    assert signup.status_code == 201, signup.text
    user_id = signup.json()['data']['user']['id']
    access_token = signup.json()['data']['session']['access_token']
    claims = jwt.decode(access_token, settings.jwt_secret_key, algorithms=['HS256'])
    assert claims['sub'] == user_id
    assert claims['role'] == 'student'
    assert claims['exp'] > int(time.time())

    authenticated = {'Authorization': f'Bearer {access_token}'}
    assert client.get('/api/auth/me', headers=authenticated).status_code == 200
    assert client.get(f'/api/auth/me?user_id={user_id}').status_code == 401
    assert client.get('/api/auth/me', headers={'Authorization': f'Bearer {user_id}'}).status_code == 401
    assert client.get('/api/admin/settings', headers={'Authorization': 'Bearer admin-1'}).status_code == 401

    forged = jwt.encode(
        {'sub': user_id, 'role': 'student', 'exp': int(time.time()) + 60},
        'wrong-signing-key-that-is-not-valid',
        algorithm='HS256',
    )
    expired = jwt.encode(
        {'sub': user_id, 'role': 'student', 'exp': int(time.time()) - 1},
        settings.jwt_secret_key,
        algorithm='HS256',
    )
    wrong_role = jwt.encode(
        {'sub': user_id, 'role': 'admin', 'exp': int(time.time()) + 60},
        settings.jwt_secret_key,
        algorithm='HS256',
    )
    for invalid_token in (forged, expired, wrong_role):
        response = client.get('/api/auth/me', headers={'Authorization': f'Bearer {invalid_token}'})
        assert response.status_code == 401, response.text

    signed_admin = create_access_token('admin-1', 'admin')
    assert client.get('/api/admin/settings', headers={'Authorization': f'Bearer {signed_admin}'}).status_code == 200


def test_sign_in_normalizes_email_and_password() -> None:
    unique_email = f'trimmed.case.user+{uuid.uuid4().hex}@example.com'
    response = client.post(
        '/api/auth/sign-up',
        json={
            'email': unique_email,
            'password': 'Secret123',
            'full_name': 'Trimmed User',
            'role': 'student',
        },
    )
    assert response.status_code == 201, response.text

    sign_in = client.post(
        '/api/auth/sign-in',
        json={'email': f'  {unique_email.upper()}  ', 'password': ' Secret123 '},
    )
    assert sign_in.status_code == 200, sign_in.text
    payload = sign_in.json()
    assert payload['success'] is True
    assert payload['data']['user']['email'] == unique_email.lower()
