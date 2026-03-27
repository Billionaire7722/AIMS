from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess

import mido
import numpy as np
from music21 import pitch as music21_pitch

from app.services.analysis import NoteEvent


@dataclass(frozen=True)
class ParsedMidiEvents:
    note_events: list[NoteEvent]
    midi_tempo_bpm: float | None
    note_count: int


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


def parse_midi_to_events(
    midi_path: Path,
    *,
    beat_times_sec: list[float] | None = None,
    fallback_tempo_bpm: float = 120.0,
) -> ParsedMidiEvents:
    midi = mido.MidiFile(str(midi_path))
    midi_tempo_bpm = _extract_midi_tempo_bpm(midi)
    beat_mapper = _build_beat_mapper(
        beat_times_sec=beat_times_sec or [],
        fallback_tempo_bpm=fallback_tempo_bpm,
    )

    absolute_time_sec = 0.0
    active_notes: dict[tuple[int, int], list[tuple[float, int]]] = {}
    note_events: list[NoteEvent] = []

    for message in midi:
        absolute_time_sec += float(message.time)
        if message.type == "note_on" and message.velocity > 0:
            active_notes.setdefault((message.channel, message.note), []).append((absolute_time_sec, int(message.velocity)))
            continue

        if message.type not in {"note_off", "note_on"}:
            continue

        key = (message.channel, message.note)
        if not active_notes.get(key):
            continue

        start_sec, velocity = active_notes[key].pop(0)
        end_sec = max(start_sec + 0.02, absolute_time_sec)
        start_beat = round(beat_mapper(start_sec), 4)
        end_beat = round(max(start_beat + 0.05, beat_mapper(end_sec)), 4)
        duration_sec = round(end_sec - start_sec, 6)
        confidence = _estimate_raw_note_confidence(
            pitch_value=message.note,
            velocity=velocity,
            duration_sec=duration_sec,
        )
        note_events.append(
            NoteEvent(
                pitch=int(message.note),
                start_ql=start_beat,
                duration_ql=round(max(0.05, end_beat - start_beat), 4),
                velocity=velocity,
                confidence=confidence,
                start_sec=round(start_sec, 6),
                duration_sec=duration_sec,
            )
        )

    note_events.sort(key=lambda item: (item.start_ql, item.pitch, -item.duration_ql))
    return ParsedMidiEvents(
        note_events=note_events,
        midi_tempo_bpm=midi_tempo_bpm,
        note_count=len(note_events),
    )


def _extract_midi_tempo_bpm(midi: mido.MidiFile) -> float | None:
    for track in midi.tracks:
        for message in track:
            if message.type == "set_tempo":
                return round(float(mido.tempo2bpm(message.tempo)), 4)
    return None


def _build_beat_mapper(
    *,
    beat_times_sec: list[float],
    fallback_tempo_bpm: float,
):
    beat_times = sorted(
        {
            round(float(time_value), 6)
            for time_value in beat_times_sec
            if np.isfinite(time_value) and time_value >= 0
        }
    )
    if not beat_times or beat_times[0] > 0.15:
        beat_times = [0.0, *beat_times]
    beat_times = sorted(set(beat_times))
    if len(beat_times) >= 2:
        default_interval = float(np.median(np.diff(np.asarray(beat_times, dtype=float))))
    else:
        default_interval = 60.0 / max(fallback_tempo_bpm, 1.0)
    default_interval = max(default_interval, 1e-6)

    def map_seconds_to_beats(seconds: float) -> float:
        clamped = max(0.0, float(seconds))
        if not beat_times:
            return clamped / default_interval
        if clamped <= beat_times[0]:
            return max(0.0, (clamped - beat_times[0]) / default_interval)
        if clamped >= beat_times[-1]:
            return (len(beat_times) - 1) + ((clamped - beat_times[-1]) / default_interval)
        return float(np.interp(clamped, beat_times, np.arange(len(beat_times), dtype=float)))

    return map_seconds_to_beats


def _estimate_raw_note_confidence(*, pitch_value: int, velocity: int, duration_sec: float) -> float:
    velocity_score = _clamp((velocity - 35) / 60.0, 0.0, 1.0)
    duration_score = _clamp(duration_sec / 0.45, 0.0, 1.0)
    register_score = 0.45 if pitch_value < 36 or pitch_value > 96 else 0.7 if pitch_value < 40 or pitch_value > 92 else 1.0
    confidence = ((0.45 * velocity_score) + (0.4 * duration_score) + (0.15 * register_score))
    return round(_clamp(confidence, 0.05, 0.99), 4)


def midi_pitch_name(midi_value: int) -> str:
    return music21_pitch.Pitch(midi_value).nameWithOctave


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
