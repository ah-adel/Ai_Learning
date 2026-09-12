from pydantic import BaseModel, Field


class Settings(BaseModel):
    app_name: str = Field(default="Async Catalog API")
    debug: bool = Field(default=False)
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)


settings = Settings()
