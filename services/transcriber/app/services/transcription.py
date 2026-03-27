import subprocess
from pathlib import Path

from music21 import converter


def run_aria_amt_transcription(
    *,
    aria_amt_bin: str,
    checkpoint_path: str,
    audio_path: Path,
    save_dir: Path,
) -> Path:
    if not checkpoint_path:
        raise RuntimeError("ARIA_AMT_CHECKPOINT_PATH is not set. Download the official checkpoint and point the service to it.")
    checkpoint_file = Path(checkpoint_path)
    if not checkpoint_file.exists():
        raise RuntimeError(f"ARIA-AMT checkpoint was not found: {checkpoint_file}")
    save_dir.mkdir(parents=True, exist_ok=True)
    command = [
        aria_amt_bin,
        "transcribe",
        "medium-double",
        str(checkpoint_file),
        "-load_path",
        str(audio_path),
        "-save_dir",
        str(save_dir),
        "-bs",
        "1",
        "-compile",
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            "aria-amt transcription failed: "
            f"{completed.stderr.strip() or completed.stdout.strip()}"
        )
    midi_files = list(save_dir.rglob("*.mid")) + list(save_dir.rglob("*.midi"))
    if not midi_files:
        raise RuntimeError(f"aria-amt completed but did not produce a MIDI file in {save_dir}")
    midi_files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return midi_files[0]


def parse_midi_to_events(midi_path: Path):
    score = converter.parse(str(midi_path))
    events = []
    for element in score.recurse().notesAndRests:
        if element.isNote:
            events.append(
                {
                    "pitch": int(element.pitch.midi),
                    "start_ql": float(element.offset),
                    "duration_ql": max(float(element.quarterLength), 0.125),
                    "velocity": int(getattr(element.volume, "velocity", 64) or 64),
                }
            )
        elif element.isChord:
            for pitch in element.pitches:
                events.append(
                    {
                        "pitch": int(pitch.midi),
                        "start_ql": float(element.offset),
                        "duration_ql": max(float(element.quarterLength), 0.125),
                        "velocity": int(getattr(element.volume, "velocity", 64) or 64),
                    }
                )
    events.sort(key=lambda item: (item["start_ql"], item["pitch"]))
    return events
