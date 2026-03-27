import subprocess
from pathlib import Path


def extract_normalized_wav(ffmpeg_path: str, input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-af",
        "loudnorm=I=-16:LRA=11:TP=-1.5,highpass=f=30,lowpass=f=18000",
        "-f",
        "wav",
        str(output_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"FFmpeg preprocessing failed: {completed.stderr.strip() or completed.stdout.strip()}")
