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

    transcriber_port: int = Field(default=8001, alias="TRANSCRIBER_PORT")
    upload_dir: Path = Field(default=Path("../../uploads"), alias="UPLOAD_DIR")
    generated_assets_dir: Path = Field(default=Path("../../generated-assets"), alias="GENERATED_ASSETS_DIR")
    ffmpeg_path: str = Field(default="ffmpeg", alias="FFMPEG_PATH")
    python_env: str = Field(default="development", alias="PYTHON_ENV")
    api_base_url: str = Field(default="http://127.0.0.1:4000", alias="API_BASE_URL")
    aria_amt_bin: str = Field(default="aria-amt", alias="ARIA_AMT_BIN")
    aria_amt_checkpoint_path: str = Field(default="", alias="ARIA_AMT_CHECKPOINT_PATH")
    preprocess_sample_rate: int = Field(default=22050, alias="PREPROCESS_SAMPLE_RATE")
    preprocess_trim_top_db: float = Field(default=35.0, alias="PREPROCESS_TRIM_TOP_DB")
    preprocess_trim_padding_ms: int = Field(default=80, alias="PREPROCESS_TRIM_PADDING_MS")
    preprocess_target_peak: float = Field(default=0.92, alias="PREPROCESS_TARGET_PEAK")
    preprocess_max_boost: float = Field(default=2.5, alias="PREPROCESS_MAX_BOOST")
    simple_piano_confidence_cutoff: float = Field(default=0.60, alias="SIMPLE_PIANO_CONFIDENCE_CUTOFF")
    simple_piano_min_duration_ql: float = Field(default=0.28, alias="SIMPLE_PIANO_MIN_DURATION_QL")
    simple_piano_onset_merge_tolerance_ql: float = Field(default=0.08, alias="SIMPLE_PIANO_ONSET_MERGE_TOLERANCE_QL")
    simple_piano_overlap_merge_tolerance_ql: float = Field(default=0.05, alias="SIMPLE_PIANO_OVERLAP_MERGE_TOLERANCE_QL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
