from typing import Optional

from app.core.models import TranscriberJobState


class JobStateStore:
    def __init__(self) -> None:
        self._states: dict[str, TranscriberJobState] = {}

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        self._states.clear()

    async def set(self, state: TranscriberJobState) -> None:
        self._states[state.id] = state

    async def get(self, job_id: str) -> Optional[TranscriberJobState]:
        return self._states.get(job_id)
