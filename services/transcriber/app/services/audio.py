from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import subprocess

import librosa
import numpy as np
import soundfile as sf


@dataclass(frozen=True)
class AudioPreprocessingConfig:
    sample_rate: int = 22050
    mono: bool = True
    trim_top_db: float = 35.0
    trim_padding_ms: int = 80
    target_peak: float = 0.92
    max_boost: float = 2.5


@dataclass(frozen=True)
class AudioPreprocessingResult:
    decoded_path: str
    output_path: str
    sample_rate: int
    channels: int
    decoded_duration_sec: float
    output_duration_sec: float
    trim_start_sec: float
    trim_end_sec: float
    peak_before_norm: float
    peak_after_norm: float
    applied_gain: float

    def to_dict(self) -> dict[str, float | int | str]:
        return asdict(self)


def extract_normalized_wav(
    ffmpeg_path: str,
    input_path: Path,
    output_path: Path,
    *,
    config: AudioPreprocessingConfig | None = None,
) -> AudioPreprocessingResult:
    active_config = config or AudioPreprocessingConfig()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    decoded_path = output_path.parent / "decoded.wav"
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1" if active_config.mono else "2",
        "-ar",
        str(active_config.sample_rate),
        "-sample_fmt",
        "s16",
        "-f",
        "wav",
        str(decoded_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"FFmpeg preprocessing failed: {completed.stderr.strip() or completed.stdout.strip()}")

    waveform, sample_rate = sf.read(str(decoded_path), dtype="float32")
    if waveform.ndim > 1:
        waveform = waveform.mean(axis=1)
    decoded_duration_sec = len(waveform) / max(sample_rate, 1)

    trim_start_sec = 0.0
    trim_end_sec = decoded_duration_sec
    if waveform.size > 0:
        trimmed, trim_indices = librosa.effects.trim(
            waveform,
            top_db=active_config.trim_top_db,
        )
        if trimmed.size > 0:
            pad_samples = int(sample_rate * (active_config.trim_padding_ms / 1000.0))
            start_index = max(0, int(trim_indices[0]) - pad_samples)
            end_index = min(len(waveform), int(trim_indices[1]) + pad_samples)
            if end_index - start_index >= max(sample_rate // 2, 1):
                waveform = waveform[start_index:end_index]
                trim_start_sec = start_index / sample_rate
                trim_end_sec = end_index / sample_rate

    peak_before = float(np.max(np.abs(waveform))) if waveform.size else 0.0
    applied_gain = 1.0
    if peak_before > 0:
        target_gain = active_config.target_peak / max(peak_before, 1e-9)
        applied_gain = min(active_config.max_boost, target_gain)
        waveform = np.clip(waveform * applied_gain, -1.0, 1.0)
    peak_after = float(np.max(np.abs(waveform))) if waveform.size else 0.0

    sf.write(str(output_path), waveform, sample_rate, subtype="PCM_16")

    return AudioPreprocessingResult(
        decoded_path=str(decoded_path),
        output_path=str(output_path),
        sample_rate=sample_rate,
        channels=1,
        decoded_duration_sec=round(decoded_duration_sec, 6),
        output_duration_sec=round(len(waveform) / max(sample_rate, 1), 6),
        trim_start_sec=round(trim_start_sec, 6),
        trim_end_sec=round(trim_end_sec, 6),
        peak_before_norm=round(peak_before, 6),
        peak_after_norm=round(peak_after, 6),
        applied_gain=round(applied_gain, 6),
    )
