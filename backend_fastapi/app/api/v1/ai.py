from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.ai import VideoAnalysisRequest, VideoAnalysisResult
from app.services.ai_service import AIServiceError, analyze_video_async, poll_video_status_async

router = APIRouter()


@router.post(
    "/ai/analyze",
    response_model=VideoAnalysisResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a video analysis job to the local AI service",
)
async def analyze_video_endpoint(payload: VideoAnalysisRequest) -> VideoAnalysisResult:
    try:
        return await analyze_video_async(payload)
    except AIServiceError as exc:
        raise HTTPException(
            status_code=exc.status_code or status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": exc.message,
                "details": exc.details,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Unexpected error during video analysis.",
                "details": str(exc),
            },
        ) from exc


@router.get(
    "/ai/jobs/{job_id}",
    response_model=VideoAnalysisResult,
    status_code=status.HTTP_200_OK,
    summary="Poll the status of an AI video analysis job",
)
async def get_analysis_status(job_id: str, timeout_seconds: float | None = Query(default=None, gt=0, le=600)) -> VideoAnalysisResult:
    try:
        return await poll_video_status_async(job_id, timeout_seconds=timeout_seconds)
    except AIServiceError as exc:
        raise HTTPException(
            status_code=exc.status_code or status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": exc.message,
                "details": exc.details,
            },
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive guard
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Unexpected error while polling the AI analysis job.",
                "details": str(exc),
            },
        ) from exc
