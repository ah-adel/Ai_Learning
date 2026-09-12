import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes.items import router as items_router
from app.api.routes.media import router as media_router
from app.api.v1.ai import router as ai_router
from app.routers.upload import router as upload_router
from app.schemas.common import ApiSuccessResponse

logger = logging.getLogger("app.main")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Async Catalog API",
    version="0.1.0",
    description="A modern FastAPI service with strict validation and async endpoints.",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_STATIC_DIR = str(Path(__file__).resolve().parent.parent / "uploads")
app.mount("/uploads", StaticFiles(directory=UPLOAD_STATIC_DIR), name="uploads")


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    payload: dict[str, Any] = {"success": False, "error": "Request failed."}

    if isinstance(detail, dict):
        payload["error"] = detail.get("error") or payload["error"]
        payload["details"] = detail.get("details")
    elif isinstance(detail, str):
        payload["error"] = detail
    else:
        payload["details"] = detail

    logger.warning(
        "HTTP exception for %s %s -> status=%s detail=%s",
        request.method,
        request.url.path,
        exc.status_code,
        detail,
    )
    return JSONResponse(status_code=exc.status_code, content=payload)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return {"service": "Async Catalog API", "status": "ok"}


@app.get("/health", response_model=ApiSuccessResponse[dict[str, str]], tags=["meta"])
async def health_check() -> ApiSuccessResponse[dict[str, str]]:
    return ApiSuccessResponse[dict[str, str]](
        data={
            "status": "ok",
            "environment": "development",
            "uploadRoot": "/uploads",
        },
        message="Backend is healthy.",
    )


app.include_router(items_router, prefix="/api/v1", tags=["items"])
app.include_router(ai_router, prefix="/api/v1", tags=["ai"])
app.include_router(media_router, prefix="/api", tags=["media"])
app.include_router(upload_router, prefix="/api", tags=["uploads"])
