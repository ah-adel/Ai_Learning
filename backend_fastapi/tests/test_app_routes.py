from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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
