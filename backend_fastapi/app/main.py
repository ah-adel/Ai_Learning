import logging
import mimetypes
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.courses import router as courses_router
from app.api.routes.items import router as items_router
from app.api.routes.media import router as media_router
from app.api.v1.ai import router as ai_router
from app.core.config import settings
from app.db import initialize_database
from app.routers.upload import router as upload_router
from app.schemas.common import ApiSuccessResponse

logger = logging.getLogger("app.main")
logging.basicConfig(level=logging.INFO)

initialize_database()

app = FastAPI(
    title="Async Catalog API",
    version="0.1.0",
    description="A modern FastAPI service with strict validation and async endpoints.",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://172.29.160.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"https?://172\.29\.\d{1,3}\.\d{1,3}(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

UPLOAD_STATIC_DIR = settings.upload_dir
UPLOAD_STATIC_DIR.mkdir(parents=True, exist_ok=True)

_RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)$")
_STREAM_CHUNK_SIZE = 1024 * 1024


def _resolve_upload_file(folder: str, filename: str) -> Path:
    upload_root = UPLOAD_STATIC_DIR.resolve()
    candidate = (upload_root / folder / filename).resolve()
    if upload_root not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found.")
    return candidate


def _parse_range(range_header: str | None, file_size: int) -> tuple[int, int, int] | None:
    if not range_header:
        return None

    match = _RANGE_PATTERN.fullmatch(range_header.strip())
    if not match:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Invalid byte range.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start_text, end_text = match.groups()
    if not start_text and not end_text:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Invalid byte range.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    if not start_text:
        suffix_length = min(int(end_text), file_size)
        start = file_size - suffix_length
        end = file_size - 1
    else:
        start = int(start_text)
        end = min(int(end_text), file_size - 1) if end_text else file_size - 1

    if start < 0 or start >= file_size or end < start:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Requested byte range is not satisfiable.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    return start, end, end - start + 1


def _iter_file_chunks(file_path: Path, start: int, length: int):
    with file_path.open("rb") as stream:
        stream.seek(start)
        remaining = length
        while remaining:
            chunk = stream.read(min(_STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def stream_upload(folder: str, filename: str, range_header: str | None) -> StreamingResponse:
    file_path = _resolve_upload_file(folder, filename)
    file_size = file_path.stat().st_size
    requested_range = _parse_range(range_header, file_size)
    start, end, content_length = requested_range or (0, file_size - 1, file_size)
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": media_type,
        "Content-Disposition": f'inline; filename="video{file_path.suffix}"; filename*=UTF-8\'\'{quote(file_path.name)}',
    }
    status_code = status.HTTP_206_PARTIAL_CONTENT if requested_range else status.HTTP_200_OK
    if requested_range:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        _iter_file_chunks(file_path, start, content_length),
        status_code=status_code,
        headers=headers,
        media_type=media_type,
    )


@app.get("/uploads/{folder}/{filename:path}", include_in_schema=False)
async def stream_upload_file(folder: str, filename: str, request: Request) -> StreamingResponse:
    return stream_upload(folder, filename, request.headers.get("range"))


@app.head("/uploads/{folder}/{filename:path}", include_in_schema=False)
async def head_upload_file(folder: str, filename: str, request: Request) -> StreamingResponse:
    return stream_upload(folder, filename, request.headers.get("range"))


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
    return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)


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


app.include_router(admin_router, prefix="/api", tags=["admin"])
app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(courses_router, prefix="/api", tags=["courses"])
app.include_router(items_router, prefix="/api/v1", tags=["items"])
app.include_router(ai_router, prefix="/api/v1", tags=["ai"])
app.include_router(media_router, prefix="/api", tags=["media"])
app.include_router(upload_router, prefix="/api", tags=["uploads"])
