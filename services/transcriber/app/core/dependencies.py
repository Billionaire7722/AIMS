import shutil
import subprocess
from pathlib import Path

from app.core.config import Settings


class DependencyError(RuntimeError):
    pass


def _resolve_command(command: str) -> str | None:
    path = Path(command)
    if path.exists():
        return str(path)
    return shutil.which(command)


def _run_check(command: str, args: list[str], label: str) -> None:
    resolved = _resolve_command(command)
    if not resolved:
        raise DependencyError(f"{label} was not found. Set the corresponding env var or install it on PATH.")
    try:
        completed = subprocess.run(
            [resolved, *args],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError as error:
        raise DependencyError(f"{label} could not be executed: {error}") from error
    except subprocess.TimeoutExpired as error:
        raise DependencyError(f"{label} did not respond in time while validating startup.") from error
    if completed.returncode != 0:
        output = completed.stderr.strip() or completed.stdout.strip()
        raise DependencyError(f"{label} failed its startup check: {output or 'unknown error'}")


def check_runtime_dependencies(settings: Settings) -> None:
    for directory in (settings.upload_dir, settings.generated_assets_dir):
        directory.mkdir(parents=True, exist_ok=True)
        if not directory.exists():
            raise DependencyError(f"Required directory could not be created: {directory}")

    _run_check(settings.ffmpeg_path, ["-version"], "FFmpeg")
    _run_check(settings.aria_amt_bin, ["--help"], "aria-amt")

    checkpoint = settings.aria_amt_checkpoint_path.strip()
    if not checkpoint:
        raise DependencyError(
            "ARIA_AMT_CHECKPOINT_PATH is not set. Download the official piano-medium-double checkpoint "
            "and point this env var at the local .safetensors file."
        )
    checkpoint_path = Path(checkpoint)
    if not checkpoint_path.exists():
        raise DependencyError(f"ARIA_AMT_CHECKPOINT_PATH does not exist: {checkpoint_path}")
    if not checkpoint_path.is_file():
        raise DependencyError(f"ARIA_AMT_CHECKPOINT_PATH must point to a file: {checkpoint_path}")
