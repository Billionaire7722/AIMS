from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env", ".env.local", "../../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(default="", alias="DATABASE_URL")
    transcriber_port: int = Field(default=8001, alias="TRANSCRIBER_PORT")
    upload_dir: Path = Field(default=Path("../../uploads"), alias="UPLOAD_DIR")
    generated_assets_dir: Path = Field(default=Path("../../generated-assets"), alias="GENERATED_ASSETS_DIR")
    ffmpeg_path: str = Field(default="ffmpeg", alias="FFMPEG_PATH")
    python_env: str = Field(default="development", alias="PYTHON_ENV")
    api_base_url: str = Field(default="http://127.0.0.1:4000", alias="API_BASE_URL")
    aria_amt_bin: str = Field(default="aria-amt", alias="ARIA_AMT_BIN")
    aria_amt_checkpoint_path: str = Field(default="", alias="ARIA_AMT_CHECKPOINT_PATH")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
