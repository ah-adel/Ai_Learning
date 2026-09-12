from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles

router = APIRouter()
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(name: str) -> str:
    candidate = Path(name).name.replace("/", "_").replace("\\", "_")
    return candidate or "upload.bin"


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_single_file(file: UploadFile = File(...)) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "No file provided.", "details": {"field": "file"}})

    safe_name = _safe_filename(file.filename)
    destination = UPLOAD_DIR / safe_name
    destination.write_bytes(await file.read())
    return {"url": f"/uploads/{safe_name}"}


@router.post("/media/upload", status_code=status.HTTP_201_CREATED)
async def upload_media_file(file: UploadFile = File(...)) -> dict[str, str]:
    return await upload_single_file(file)


@router.post("/media/uploads", status_code=status.HTTP_201_CREATED)
async def upload_multiple_files(files: list[UploadFile] = File(...)) -> dict[str, list[str]]:
    urls: list[str] = []
    for file in files:
        if not file.filename:
            continue
        safe_name = _safe_filename(file.filename)
        destination = UPLOAD_DIR / safe_name
        destination.write_bytes(await file.read())
        urls.append(f"/uploads/{safe_name}")
    return {"urls": urls}
