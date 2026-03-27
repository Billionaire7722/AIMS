from enum import Enum
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


class OutputMode(str, Enum):
    original = "original"
    study_friendly = "study-friendly"


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class HealthResponse(BaseModel):
    ok: bool
    service: str


class TranscriberJobRequest(BaseModel):
    uploadPath: str
    uploadFileName: str
    outputRoot: str
    mode: OutputMode
    jobId: str
    callbackBaseUrl: Optional[str] = None


class TranscriberAssetPath(BaseModel):
    mode: OutputMode
    musicxmlPath: str
    midiPath: str
    rawNotesPath: Optional[str] = None


class TranscriberResult(BaseModel):
    jobId: str
    tempoBpm: float
    timeSignature: str
    keySignature: str = "C"
    highestNote: str
    lowestNote: str
    repeatedSections: list[str]
    benchmark: dict[str, float]
    notesCount: int
    warnings: list[str] = Field(default_factory=list)
    assets: list[TranscriberAssetPath]
    rawNotesPath: Optional[str] = None
    debugNotesPath: Optional[str] = None
    studyNotesPath: Optional[str] = None
    modelInfo: Optional[dict[str, str | float | int | bool | None]] = None


class TranscriberJobState(BaseModel):
    id: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    stage: str
    message: Optional[str] = None
    result: Optional[TranscriberResult] = None
    errorMessage: Optional[str] = None
    benchmark: dict[str, float] = Field(default_factory=dict)
    updatedAt: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_state(
    *,
    job_id: str,
    status: JobStatus,
    progress: int,
    stage: str,
    message: Optional[str] = None,
    result: Optional[TranscriberResult] = None,
    error_message: Optional[str] = None,
    benchmark: Optional[dict[str, float]] = None,
) -> TranscriberJobState:
    return TranscriberJobState(
        id=job_id,
        status=status,
        progress=progress,
        stage=stage,
        message=message,
        result=result,
        errorMessage=error_message,
        benchmark=benchmark or {},
        updatedAt=utc_now_iso(),
    )
