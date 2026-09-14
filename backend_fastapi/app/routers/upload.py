from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from app.services.media_service import process_media_upload

router = APIRouter()


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_single_file(file: UploadFile = File(...)) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "No file provided.", "details": {"field": "file"}})

    result = await process_media_upload(file, "video" if (file.content_type or "").startswith("video/") else "attachment")
    return {"url": str(result["url"])}


@router.post("/media/upload", status_code=status.HTTP_201_CREATED)
async def upload_media_file(file: UploadFile = File(...)) -> dict[str, str]:
    return await upload_single_file(file)


@router.post("/media/uploads", status_code=status.HTTP_201_CREATED)
async def upload_multiple_files(files: list[UploadFile] = File(...)) -> dict[str, list[str]]:
    urls: list[str] = []
    for file in files:
        if not file.filename:
            continue
        result = await process_media_upload(file, "video" if (file.content_type or "").startswith("video/") else "attachment")
        urls.append(str(result["url"]))
    return {"urls": urls}
