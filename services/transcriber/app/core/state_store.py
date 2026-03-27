from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.models import TranscriberJobState


class JobStateStore:
    def __init__(self, database_url: str):
        self.client = AsyncIOMotorClient(database_url)
        self.collection = self.client.get_default_database()["transcriber_job_states"]

    async def initialize(self) -> None:
        await self.collection.create_index("id", unique=True)

    async def close(self) -> None:
        self.client.close()

    async def set(self, state: TranscriberJobState) -> None:
        await self.collection.replace_one({"id": state.id}, state.model_dump(), upsert=True)

    async def get(self, job_id: str) -> Optional[TranscriberJobState]:
        data = await self.collection.find_one({"id": job_id})
        if data is None:
            return None
        return TranscriberJobState.model_validate(data)
