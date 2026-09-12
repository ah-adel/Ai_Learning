from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.schemas.common import ApiErrorResponse, ApiSuccessResponse, DeleteCleanupResult, MediaUploadResult
from app.services.media_service import process_deletion, process_media_upload

router = APIRouter()
logger = logging.getLogger("app.api.routes.media")


@router.post(
    "/media/upload",
    response_model=ApiSuccessResponse[MediaUploadResult],
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": ApiErrorResponse},
        413: {"model": ApiErrorResponse},
        415: {"model": ApiErrorResponse},
    },
)
async def upload_media(
    file: UploadFile = File(..., description="The media file to upload."),
    type: str | None = Form(default=None, description="Media kind: video or attachment."),
) -> ApiSuccessResponse[MediaUploadResult]:
    logger.info(
        "media upload started: filename=%s content_type=%s field_type=%s",
        getattr(file, "filename", None),
        getattr(file, "content_type", None),
        type,
    )
    try:
        result = await process_media_upload(file, type)
        logger.info("media upload succeeded: url=%s filename=%s", result.get("url"), result.get("file_name"))
        return ApiSuccessResponse[MediaUploadResult](
            data=MediaUploadResult.model_validate(result),
            message="Media uploaded successfully.",
        )
    except HTTPException as exc:
        logger.warning(
            "media upload rejected: filename=%s status=%s detail=%s",
            getattr(file, "filename", None),
            getattr(exc, "status_code", None),
            exc.detail,
        )
        raise
    except Exception as exc:  # pragma: no cover - defensive boundary
        logger.exception("unhandled media upload error for filename=%s", getattr(file, "filename", None))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"error": "Unable to upload media.", "details": str(exc)}) from exc


@router.post(
    "/media/delete",
    response_model=ApiSuccessResponse[DeleteCleanupResult],
    status_code=status.HTTP_200_OK,
    responses={400: {"model": ApiErrorResponse}, 500: {"model": ApiErrorResponse}},
)
async def delete_media_entity(
    entity: dict[str, Any] | None = None,
) -> ApiSuccessResponse[DeleteCleanupResult]:
    if entity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "Missing entity payload for deletion cleanup.", "details": {"body": None}})

    try:
        result = await process_deletion(entity, database_store={})
        return ApiSuccessResponse[DeleteCleanupResult](
            data=DeleteCleanupResult.model_validate(result),
            message="Related media and references were cleaned successfully.",
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive boundary
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"error": "Unable to delete media references.", "details": str(exc)}) from exc


@router.post(
    "/upload-media",
    response_model=ApiSuccessResponse[MediaUploadResult],
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def upload_media_alias(
    file: UploadFile = File(..., description="The media file to upload."),
    type: str | None = Form(default=None, description="Media kind: video or attachment."),
) -> ApiSuccessResponse[MediaUploadResult]:
    return await upload_media(file=file, type=type)


@router.post(
    "/delete-entity",
    response_model=ApiSuccessResponse[DeleteCleanupResult],
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def delete_media_entity_alias(
    entity: dict[str, Any] | None = None,
) -> ApiSuccessResponse[DeleteCleanupResult]:
    return await delete_media_entity(entity=entity)
