from dataclasses import dataclass
from pathlib import Path
import math
import librosa
import music21
import numpy as np


@dataclass
class NoteEvent:
    pitch: int
    start_ql: float
    duration_ql: float
    velocity: int = 64
    confidence: float | None = None
    hand: str | None = None


MEASURE_SIGNATURE_WIDTH = 12 + 8 + 4 + 2


def estimate_tempo_and_beats(audio_path: Path) -> tuple[float, list[float], float]:
    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    onset_envelope = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=sr,
        trim=False,
        start_bpm=110,
        tightness=100,
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    tempo_array = np.asarray(tempo).reshape(-1)
    tempo_value = float(tempo_array[0]) if tempo_array.size > 0 else 120.0
    if not np.isfinite(tempo_value) or tempo_value <= 0:
        tempo_value = 120.0
    if len(beat_times) >= 3:
        beat_intervals = np.diff(np.asarray(beat_times))
        interval_mean = float(np.mean(beat_intervals)) if beat_intervals.size > 0 else 0.0
        interval_std = float(np.std(beat_intervals)) if beat_intervals.size > 0 else 0.0
        regularity = 1.0 / (1.0 + ((interval_std / interval_mean) if interval_mean > 0 else 1.0))
    else:
        regularity = 0.25

    if onset_envelope.size > 0 and len(beat_frames) > 0:
        clipped_indices = np.clip(np.asarray(beat_frames, dtype=int), 0, onset_envelope.size - 1)
        beat_strength = onset_envelope[clipped_indices]
        clarity = float(np.mean(beat_strength)) / float(np.max(onset_envelope) + 1e-9)
    else:
        clarity = 0.0

    coverage = min(1.0, len(beat_times) / 16.0)
    beat_confidence = float(np.clip((0.5 * regularity) + (0.3 * clarity) + (0.2 * coverage), 0.0, 1.0))
    return tempo_value, beat_times, beat_confidence


def _bar_length_quarter_length(time_signature: str) -> float:
    numerator, denominator = time_signature.split("/")
    return (int(numerator) * 4.0) / int(denominator)


def _strong_positions_for_signature(time_signature: str) -> list[float]:
    if time_signature == "2/4":
        return [0.0, 1.0]
    if time_signature == "3/4":
        return [0.0, 1.0, 2.0]
    if time_signature == "4/4":
        return [0.0, 1.0, 2.0, 3.0]
    if time_signature == "6/8":
        return [0.0, 1.5]
    if time_signature == "12/8":
        return [0.0, 1.5, 3.0, 4.5]
    return [0.0]


def _meter_score(events: list[NoteEvent], time_signature: str) -> float:
    if not events:
        return float("-inf")
    bar_length = _bar_length_quarter_length(time_signature)
    onsets = np.array([event.start_ql for event in events], dtype=float)
    beat_counts = np.bincount(np.floor(onsets).astype(int))
    beats_per_bar = max(1, int(round(bar_length)))
    if beat_counts.size < beats_per_bar:
        return float("-inf")

    usable_len = (beat_counts.size // beats_per_bar) * beats_per_bar
    if usable_len == 0:
        return float("-inf")

    bars = beat_counts[:usable_len].reshape(-1, beats_per_bar).astype(float)
    bar_profile = bars.mean(axis=0)
    profile_norm = float(np.linalg.norm(bar_profile))
    if profile_norm == 0:
        return float("-inf")

    bar_lengths = np.linalg.norm(bars, axis=1)
    bar_consistency = float(
        np.mean(
            [
                float(np.dot(bar, bar_profile))
                / ((np.linalg.norm(bar) * profile_norm) + 1e-9)
                if np.linalg.norm(bar) > 0
                else 0.0
                for bar in bars
            ]
        )
    )
    probabilities = bar_profile / (float(bar_profile.sum()) + 1e-9)
    entropy = -float(np.sum(probabilities * np.log(probabilities + 1e-9)))

    strong_positions = _strong_positions_for_signature(time_signature)
    positions = np.mod(onsets, bar_length)
    strong_distances = np.min(
        [
            np.minimum(np.abs(positions - strong_pos), bar_length - np.abs(positions - strong_pos))
            for strong_pos in strong_positions
        ],
        axis=0,
    )
    strong_alignment = float(np.mean(np.exp(-strong_distances / 0.22)))
    bar_evenness = 1.0 / (1.0 + float(np.std(bars.sum(axis=1))))

    return (bar_consistency * 1.6) + (strong_alignment * 1.1) + (bar_evenness * 0.4) - (entropy * 0.15)


def infer_time_signature(
    beat_times: list[float],
    tempo_bpm: float,
    events: list[NoteEvent] | None = None,
    beat_confidence: float = 0.5,
) -> tuple[str, float]:
    if len(beat_times) < 4:
        return "4/4", 0.2
    beat_intervals = np.diff(np.array(beat_times))
    if len(beat_intervals) == 0:
        return "4/4", 0.2

    if not events:
        fallback = "4/4" if tempo_bpm >= 72 else "3/4"
        return fallback, 0.25

    candidates = ["2/4", "3/4", "4/4", "6/8", "12/8"]
    scores = {candidate: _meter_score(events, candidate) for candidate in candidates}
    best_signature = max(scores, key=scores.get)
    ordered_scores = sorted(scores.values(), reverse=True)
    second_score = ordered_scores[1] if len(ordered_scores) > 1 else float("-inf")
    margin = scores[best_signature] - second_score
    confidence = float(np.clip((0.55 * beat_confidence) + (0.45 * np.tanh(max(margin, 0.0))), 0.0, 1.0))

    if confidence < 0.55:
        return "4/4", confidence
    if best_signature in {"6/8", "12/8"} and tempo_bpm < 80:
        return "6/8", confidence
    if best_signature == "3/4" and scores["3/4"] >= scores["4/4"] - 0.1 and tempo_bpm < 140:
        return "3/4", confidence
    if best_signature == "2/4" and scores["2/4"] >= scores["4/4"] - 0.1:
        return "2/4", confidence
    return best_signature, confidence


def midi_score_to_note_events(score: music21.stream.Score) -> list[NoteEvent]:
    events: list[NoteEvent] = []
    for element in score.recurse().notesAndRests:
        if isinstance(element, music21.note.Note):
            events.append(
                NoteEvent(
                    pitch=int(element.pitch.midi),
                    start_ql=float(element.offset),
                    duration_ql=max(float(element.quarterLength), 0.125),
                    velocity=int(getattr(element.volume, "velocity", 64) or 64),
                )
            )
        elif isinstance(element, music21.chord.Chord):
            for pitch in element.pitches:
                events.append(
                    NoteEvent(
                        pitch=int(pitch.midi),
                        start_ql=float(element.offset),
                        duration_ql=max(float(element.quarterLength), 0.125),
                        velocity=int(getattr(element.volume, "velocity", 64) or 64),
                    )
                )
    events.sort(key=lambda event: (event.start_ql, event.pitch))
    return events


def quantize_events(events: list[NoteEvent], time_signature: str, subdivision: int = 4) -> list[NoteEvent]:
    if not events:
        return []
    beat_grid = 1.0 / subdivision
    minimum_duration = 1.0 / (subdivision * 2)
    quantized: list[NoteEvent] = []
    for event in events:
        start = round(event.start_ql / beat_grid) * beat_grid
        duration = max(round(event.duration_ql / beat_grid) * beat_grid, minimum_duration)
        quantized.append(
            NoteEvent(
                pitch=event.pitch,
                start_ql=max(start, 0.0),
                duration_ql=duration,
                velocity=event.velocity,
            )
        )
    quantized.sort(key=lambda event: (event.start_ql, event.pitch))
    return quantized


def split_staffs(events: list[NoteEvent], split_midi: int = 60) -> tuple[list[NoteEvent], list[NoteEvent]]:
    treble: list[NoteEvent] = []
    bass: list[NoteEvent] = []
    for event in events:
        if event.pitch >= split_midi:
            treble.append(event)
        else:
            bass.append(event)
    return treble, bass


def _measure_signatures(events: list[NoteEvent], time_signature: str) -> list[np.ndarray]:
    bar_length = _bar_length_quarter_length(time_signature)
    if not events:
        return []
    max_offset = max(event.start_ql + event.duration_ql for event in events)
    measure_count = max(1, int(np.ceil(max_offset / bar_length)))
    signatures: list[np.ndarray] = []
    for measure_index in range(measure_count):
        start = measure_index * bar_length
        end = start + bar_length
        measure_events = [event for event in events if start <= event.start_ql < end]
        pitch_hist = np.zeros(12, dtype=float)
        onset_hist = np.zeros(8, dtype=float)
        duration_hist = np.zeros(4, dtype=float)
        for event in measure_events:
            pitch_hist[event.pitch % 12] += 1.0
            onset_slot = min(7, int(((event.start_ql - start) / bar_length) * 8))
            onset_hist[onset_slot] += 1.0
            duration_slot = min(3, int(min(event.duration_ql / max(bar_length, 0.25), 0.999) * 4))
            duration_hist[duration_slot] += 1.0
        density = np.array([float(len(measure_events))], dtype=float)
        bass_ratio = np.array(
            [
                float(
                    sum(1 for event in measure_events if event.pitch < 60)
                )
                / float(len(measure_events))
                if measure_events
                else 0.0
            ],
            dtype=float,
        )
        vector = np.concatenate([pitch_hist, onset_hist, duration_hist, density, bass_ratio])
        norm = np.linalg.norm(vector)
        signatures.append(vector / norm if norm > 0 else vector)
    return signatures


def _window_similarity(left: np.ndarray, right: np.ndarray) -> float:
    if len(left) != len(right) or len(left) % MEASURE_SIGNATURE_WIDTH != 0:
        left_norm = np.linalg.norm(left)
        right_norm = np.linalg.norm(right)
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return float(np.dot(left, right) / (left_norm * right_norm))

    measure_count = len(left) // MEASURE_SIGNATURE_WIDTH
    left_norm = np.linalg.norm(left)
    if left_norm == 0:
        return 0.0

    best = 0.0
    for shift in range(12):
        rotated: list[np.ndarray] = []
        for idx in range(measure_count):
            signature = right[
                idx * MEASURE_SIGNATURE_WIDTH : (idx + 1) * MEASURE_SIGNATURE_WIDTH
            ].copy()
            signature[:12] = np.roll(signature[:12], shift)
            rotated.append(signature)
        rotated_window = np.concatenate(rotated)
        rotated_norm = np.linalg.norm(rotated_window)
        if rotated_norm == 0:
            continue
        similarity = float(np.dot(left, rotated_window) / (left_norm * rotated_norm))
        best = max(best, similarity)

    return best


def detect_repeated_sections(events: list[NoteEvent], time_signature: str) -> list[str]:
    if not events:
        return []
    signatures = _measure_signatures(events, time_signature)
    if len(signatures) < 2:
        return []

    repeated: list[str] = []
    seen: set[tuple[int, int, int]] = set()
    for window_size in (2, 4):
        if len(signatures) < window_size * 2:
            continue
        for start in range(0, len(signatures) - window_size):
            left = np.concatenate(signatures[start : start + window_size])
            for compare in range(start + window_size, len(signatures) - window_size + 1):
                right = np.concatenate(signatures[compare : compare + window_size])
                similarity = _window_similarity(left, right)
                if similarity >= 0.86 and (start, compare, window_size) not in seen:
                    seen.add((start, compare, window_size))
                    repeated.append(
                        f"Measures {start + 1}-{start + window_size} repeat at measures {compare + 1}-{compare + window_size}"
                    )
                    break
            if len(repeated) >= 8:
                return repeated[:8]

    if not repeated:
        seen: dict[tuple[int, ...], int] = {}
        for index, signature in enumerate(signatures):
            key = tuple(np.round(signature, 2).tolist())
            if key in seen:
                repeated.append(f"Measure {seen[key] + 1} repeats at measure {index + 1}")
            else:
                seen[key] = index
    return repeated[:8]
