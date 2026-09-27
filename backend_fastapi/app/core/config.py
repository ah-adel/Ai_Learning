import os
import secrets
from pathlib import Path

from pydantic import BaseModel, Field


def _env_path(name: str, default: str) -> Path:
    value = os.getenv(name, default).strip()
    return Path(value).expanduser().resolve() if value else Path(default).expanduser().resolve()


def _jwt_secret_key() -> str:
    configured_key = os.getenv("JWT_SECRET_KEY", "").strip()
    if configured_key:
        if len(configured_key.encode("utf-8")) < 32:
            raise ValueError("JWT_SECRET_KEY must contain at least 32 bytes.")
        return configured_key

    data_dir = _env_path("APP_DATA_DIR", "/app/data")
    data_dir.mkdir(parents=True, exist_ok=True)
    key_path = data_dir / ".jwt_signing_key"
    try:
        existing_key = key_path.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        existing_key = ""
    if existing_key:
        if len(existing_key.encode("ascii")) < 32:
            raise ValueError("The persisted JWT signing key is invalid.")
        return existing_key

    generated_key = secrets.token_urlsafe(64)
    temporary_path = data_dir / f".jwt_signing_key.{secrets.token_hex(8)}.tmp"
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="ascii") as key_file:
            key_file.write(generated_key)
            key_file.flush()
            os.fsync(key_file.fileno())
        try:
            os.link(temporary_path, key_path)
        except FileExistsError:
            pass
    finally:
        temporary_path.unlink(missing_ok=True)

    persisted_key = key_path.read_text(encoding="ascii").strip()
    if len(persisted_key.encode("ascii")) < 32:
        raise ValueError("The persisted JWT signing key is invalid.")
    return persisted_key


class Settings(BaseModel):
    app_name: str = Field(default_factory=lambda: os.getenv("APP_NAME", "Fasl_ai"))
    debug: bool = Field(default=False)
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/educational_platform"))
    jwt_secret_key: str = Field(default_factory=_jwt_secret_key)
    jwt_access_token_expire_minutes: int = Field(default_factory=lambda: int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60")), ge=1)
    data_dir: Path = Field(default_factory=lambda: _env_path("APP_DATA_DIR", "/app/data"))
    upload_dir: Path = Field(default_factory=lambda: _env_path("APP_UPLOAD_DIR", "/app/uploads"))

    model_config = {"arbitrary_types_allowed": True}

    def ensure_runtime_paths(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.upload_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_runtime_paths()
