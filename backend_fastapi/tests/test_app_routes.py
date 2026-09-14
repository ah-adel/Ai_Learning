from pathlib import Path
import uuid

from fastapi.testclient import TestClient

from app import db
from app import main
from app.main import app

client = TestClient(app)


def test_schema_path_is_resolved_from_the_app_root() -> None:
    resolved = db.resolve_schema_path(Path('/app/app/db.py'))
    assert resolved == Path('/app/database/schema.sql')
    assert str(resolved).startswith('/app/')
    assert not str(resolved).startswith('/database/')


def test_health_endpoint_returns_ok() -> None:
    response = client.get('/health')
    assert response.status_code == 200
    payload = response.json()
    assert payload['success'] is True
    assert payload['data']['status'] == 'ok'


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

    me = client.get(f"/api/auth/me?user_id={payload['data']['user']['id']}")
    assert me.status_code == 200, me.text
    profile_payload = me.json()
    assert profile_payload['success'] is True
    assert profile_payload['data']['profile']['full_name'] == 'Persisted User'


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
