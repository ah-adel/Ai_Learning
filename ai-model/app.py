from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Local AI Model Runner", version="0.1.0")


class AnalysisRequest(BaseModel):
    video_url: str = Field(..., min_length=1)
    prompt: str | None = None
    model_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnalysisResponse(BaseModel):
    job_id: str
    status: str = "completed"
    summary: str
    findings: list[str] = Field(default_factory=list)
    confidence: float = 0.98
    model: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "local-ai-model"}


@app.post("/analyze/video")
async def analyze_video(payload: AnalysisRequest) -> AnalysisResponse:
    model_name = payload.model_id or os.getenv("DEFAULT_MODEL_ID", "local-video-analyzer")
    prompt = payload.prompt or "Summarize the uploaded video content."
    summary = f"AI analysis complete for {payload.video_url}. Prompt: {prompt}"
    return AnalysisResponse(
        job_id="job-local-1",
        status="completed",
        summary=summary,
        findings=["Scene detected", "Object tracking complete", "Transcript summary ready"],
        model=model_name,
        metadata={"source": payload.video_url, "kind": "video-analysis"},
    )


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "status": "completed",
        "summary": "AI analysis complete.",
        "findings": ["Scene detected", "Object tracking complete"],
        "confidence": 0.98,
        "model_id": os.getenv("DEFAULT_MODEL_ID", "local-video-analyzer"),
        "metadata": {"source": "job-poll"},
    }
