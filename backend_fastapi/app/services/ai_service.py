from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.schemas.ai import VideoAnalysisRequest, VideoAnalysisResult


DEFAULT_AI_BASE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:8001")
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("AI_SERVICE_TIMEOUT_SECONDS", "30"))
DEFAULT_POLL_SECONDS = float(os.getenv("AI_SERVICE_POLL_SECONDS", "2"))
DEFAULT_STATUS_TIMEOUT_SECONDS = float(os.getenv("AI_SERVICE_STATUS_TIMEOUT_SECONDS", "120"))


@dataclass(slots=True)
class AIServiceConfig:
    base_url: str = DEFAULT_AI_BASE_URL
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    poll_seconds: float = DEFAULT_POLL_SECONDS
    status_timeout_seconds: float = DEFAULT_STATUS_TIMEOUT_SECONDS


class AIServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, details: Any | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class AIService:
    def __init__(self, config: AIServiceConfig | None = None) -> None:
        self.config = config or AIServiceConfig()

    async def analyze_video(self, request: VideoAnalysisRequest) -> VideoAnalysisResult:
        payload = request.model_dump(mode="json", exclude_none=True)
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout_seconds)) as client:
            try:
                response = await client.post(
                    f"{self.config.base_url.rstrip('/')}/analyze/video",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
                return self._parse_result(data, request.model_id)
            except httpx.TimeoutException as exc:
                raise AIServiceError("Video analysis request timed out while contacting the local AI service.", 504, {"timeout": self.config.timeout_seconds}) from exc
            except httpx.HTTPStatusError as exc:
                body: Any = None
                try:
                    body = exc.response.json()
                except Exception:
                    body = exc.response.text
                raise AIServiceError(
                    "Local AI service rejected the request.",
                    exc.response.status_code,
                    body,
                ) from exc
            except httpx.HTTPError as exc:
                raise AIServiceError("Unable to reach the local AI service for video analysis.", 503, {"endpoint": self.config.base_url}) from exc

    async def poll_analysis_status(self, job_id: str, *, timeout_seconds: float | None = None) -> VideoAnalysisResult:
        deadline = datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds or self.config.status_timeout_seconds)
        last_status: dict[str, Any] | None = None

        while datetime.now(timezone.utc) < deadline:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout_seconds)) as client:
                    response = await client.get(f"{self.config.base_url.rstrip('/')}/jobs/{job_id}")
                    response.raise_for_status()
                    data = response.json()
            except httpx.TimeoutException as exc:
                raise AIServiceError("Polling the AI service timed out.", 504, {"job_id": job_id}) from exc
            except httpx.HTTPError as exc:
                raise AIServiceError("Unable to poll the local AI analysis job status.", 503, {"job_id": job_id}) from exc

            last_status = data
            if str(data.get("status", "")).lower() in {"completed", "failed", "succeeded", "error"}:
                return self._parse_result(data, data.get("model_id"))

            await asyncio.sleep(self.config.poll_seconds)

        raise AIServiceError("AI analysis job did not finish before the configured timeout.", 504, {"job_id": job_id, "last_status": last_status})

    def _parse_result(self, payload: dict[str, Any], fallback_model_id: str | None = None) -> VideoAnalysisResult:
        if not isinstance(payload, dict):
            raise AIServiceError("Invalid response payload received from the local AI service.", 502, payload)

        model_id = payload.get("model_id") or payload.get("model") or fallback_model_id
        status = str(payload.get("status") or payload.get("state") or "pending")
        findings = payload.get("findings")
        if findings is None:
            findings = payload.get("summary_points") or payload.get("insights") or []
        if isinstance(findings, str):
            findings = [findings]

        summary = payload.get("summary") or payload.get("analysis") or payload.get("description")
        confidence = payload.get("confidence")
        if isinstance(confidence, str):
            try:
                confidence = float(confidence)
            except ValueError:
                confidence = None

        return VideoAnalysisResult(
            job_id=str(payload.get("job_id") or payload.get("id") or "unknown-job"),
            status=status,
            summary=str(summary) if summary is not None else None,
            findings=[str(item) for item in findings] if isinstance(findings, list) else [],
            confidence=float(confidence) if confidence is not None else None,
            model=str(model_id) if model_id is not None else None,
            error=str(payload.get("error")) if payload.get("error") is not None else None,
            created_at=self._coerce_datetime(payload.get("created_at")),
            completed_at=self._coerce_datetime(payload.get("completed_at") or payload.get("finished_at")),
            metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        )

    @staticmethod
    def _coerce_datetime(value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
        return None


ai_service = AIService()


async def analyze_video_async(request: VideoAnalysisRequest) -> VideoAnalysisResult:
    return await ai_service.analyze_video(request)


async def poll_video_status_async(job_id: str, *, timeout_seconds: float | None = None) -> VideoAnalysisResult:
    return await ai_service.poll_analysis_status(job_id, timeout_seconds=timeout_seconds)
