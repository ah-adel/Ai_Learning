import os
from pathlib import Path

from pydantic import BaseModel, Field


def _env_path(name: str, default: str) -> Path:
    value = os.getenv(name, default).strip()
    return Path(value).expanduser().resolve() if value else Path(default).expanduser().resolve()


class Settings(BaseModel):
    app_name: str = Field(default="Async Catalog API")
    debug: bool = Field(default=False)
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/educational_platform"))
    data_dir: Path = Field(default_factory=lambda: _env_path("APP_DATA_DIR", "/app/data"))
    upload_dir: Path = Field(default_factory=lambda: _env_path("APP_UPLOAD_DIR", "/app/uploads"))

    model_config = {"arbitrary_types_allowed": True}

    def ensure_runtime_paths(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.upload_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_runtime_paths()
