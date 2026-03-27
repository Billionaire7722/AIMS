import asyncio
import json
from pathlib import Path
from typing import Optional

from app.core.models import TranscriberJobState


class JobStateStore:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, asyncio.Lock] = {}

    def _path_for(self, job_id: str) -> Path:
        return self.root_dir / f"{job_id}.json"

    def _lock_for(self, job_id: str) -> asyncio.Lock:
        if job_id not in self._locks:
            self._locks[job_id] = asyncio.Lock()
        return self._locks[job_id]

    async def set(self, state: TranscriberJobState) -> None:
        async with self._lock_for(state.id):
            path = self._path_for(state.id)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(state.model_dump_json(indent=2), encoding="utf-8")
            tmp.replace(path)

    async def get(self, job_id: str) -> Optional[TranscriberJobState]:
        path = self._path_for(job_id)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return TranscriberJobState.model_validate(data)
