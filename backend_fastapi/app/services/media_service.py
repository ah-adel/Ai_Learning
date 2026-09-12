from __future__ import annotations

import hashlib
import mimetypes
import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status

from app.services.cleanup_service import cleanup_deletion_artifacts

PROJECT_ROOT = Path(__file__).resolve().parents[2]
UPLOAD_ROOT = PROJECT_ROOT / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME_TYPES = {
    "video": {"video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"},
    "attachment": {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "application/rtf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml",
    },
}


def resolve_upload_kind(value: str | None, mime_type: str = "") -> str:
    requested_kind = str(value or "").strip().lower()
    mime = (mime_type or "").strip().lower()
    if mime.startswith("video/") or requested_kind in {"video", "videos"}:
        return "video"
    return "attachment"


def get_upload_folder(kind: str) -> str:
    return "videos" if kind == "video" else "attachments"


def get_kind_limit(kind: str) -> int:
    return 500 * 1024 * 1024 if kind == "video" else 20 * 1024 * 1024


async def ensure_upload_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


async def process_media_upload(file: UploadFile, type_value: str | None = None, project_root: str | Path | None = None) -> dict[str, Any]:
    if file is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "No file uploaded.", "details": {"field": "file"}})

    raw_kind = resolve_upload_kind(type_value, file.content_type or "")
    max_size = get_kind_limit(raw_kind)

    if file.size and file.size > max_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail={"error": "File exceeds the allowed size limit.", "details": {"maxFileSize": max_size, "receivedFileSize": file.size}})

    allowed = ALLOWED_MIME_TYPES.get(raw_kind, ALLOWED_MIME_TYPES["attachment"])
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in allowed:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail={"error": f"Invalid file type for {raw_kind}.", "details": {"receivedType": mime_type}})

    workspace_root = Path(project_root) if project_root is not None else PROJECT_ROOT
    target_dir = workspace_root / "uploads" / get_upload_folder(raw_kind)
    await ensure_upload_directory(target_dir)

    original_name = file.filename or "upload.bin"
    extension = Path(original_name).suffix or mimetypes.guess_extension(mime_type) or ".bin"
    safe_name = Path(original_name).stem.replace("/", "_").replace("\\", "_")
    safe_name = "".join(ch for ch in safe_name if ch.isalnum() or ch in {"_", "-", "."}) or "upload"
    digest = hashlib.sha1(os.urandom(8)).hexdigest()[:12]
    stored_name = f"{safe_name}-{digest}{extension}"
    file_path = target_dir / stored_name

    content = await file.read()
    file_path.write_bytes(content)

    route = f"/uploads/{get_upload_folder(raw_kind)}/{stored_name}"
    return {
        "url": route,
        "folder": get_upload_folder(raw_kind),
        "type": raw_kind,
        "file_name": stored_name,
        "original_name": original_name,
    }


async def process_deletion(entity: dict[str, Any] | None, project_root: str | Path | None = None, database_store: dict[str, Any] | None = None) -> dict[str, Any]:
    if entity is None or not isinstance(entity, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Missing entity payload for deletion cleanup.", "details": {"body": entity}})

    workspace_root = Path(project_root) if project_root is not None else PROJECT_ROOT
    return cleanup_deletion_artifacts(entity, project_root=workspace_root, database_store=database_store)
