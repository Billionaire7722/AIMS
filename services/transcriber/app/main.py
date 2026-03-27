from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.models import HealthResponse
from app.services.pipeline import TranscriptionPipeline
from app.core.state_store import JobStateStore
from app.core.runtime_checks import validate_startup

app = FastAPI(title="AIMS Transcriber", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state_store = JobStateStore()
pipeline = TranscriptionPipeline(settings=settings, state_store=state_store)


@app.on_event("startup")
async def startup_checks():
    validate_startup(settings)
    await state_store.initialize()


@app.on_event("shutdown")
async def shutdown_state_store():
    await state_store.close()


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(ok=True, service="transcriber")


@app.get("/ready", response_model=HealthResponse)
async def ready():
    return HealthResponse(ok=True, service="transcriber")


@app.post("/jobs")
async def create_job(payload: dict):
    job = await pipeline.create_job(payload)
    return job.model_dump()


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = await state_store.get(job_id)
    if job is None:
        return {
            "id": job_id,
            "status": "failed",
            "progress": 0,
            "stage": "missing",
            "message": "Job not found",
            "errorMessage": "Job not found",
            "benchmark": {},
            "updatedAt": "",
        }
    return job.model_dump()


def run() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.transcriber_port,
        reload=settings.python_env == "development",
    )


if __name__ == "__main__":
    run()
