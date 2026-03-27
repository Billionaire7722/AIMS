from __future__ import annotations

from dataclasses import dataclass, replace
import math
from statistics import mean

import numpy as np
from music21 import key

from app.services.analysis import NoteEvent


RIGHT_HAND = "right"
LEFT_HAND = "left"
PIANO_LOW = 21
PIANO_HIGH = 108

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

NATURAL_PITCH_NAMES = {
    0: "C",
    2: "D",
    4: "E",
    5: "F",
    7: "G",
    9: "A",
    11: "B",
}
SHARP_PITCH_NAMES = {1: "C#", 3: "D#", 6: "F#", 8: "G#", 10: "A#"}
FLAT_PITCH_NAMES = {1: "D-", 3: "E-", 6: "G-", 8: "A-", 10: "B-"}
NEUTRAL_PITCH_NAMES = {1: "C#", 3: "E-", 6: "F#", 8: "G#", 10: "B-"}


@dataclass
class TimelineEntry:
    start_ql: float
    duration_ql: float
    pitches: list[int]
    hand: str
    velocity: int = 64


@dataclass(frozen=True)
class NotationProfile:
    name: str
    study_confidence_cutoff: float = 0.60
    study_min_duration_ql: float = 0.28
    onset_merge_tolerance_ql: float = 0.08
    overlap_merge_tolerance_ql: float = 0.05
    max_debug_rh_polyphony: int = 3
    max_debug_lh_polyphony: int = 2
    max_study_rh_polyphony: int = 2
    max_study_lh_polyphony: int = 1

    def as_dict(self) -> dict[str, float | int | str]:
        return {
            "name": self.name,
            "studyConfidenceCutoff": self.study_confidence_cutoff,
            "studyMinDurationQl": self.study_min_duration_ql,
            "onsetMergeToleranceQl": self.onset_merge_tolerance_ql,
            "overlapMergeToleranceQl": self.overlap_merge_tolerance_ql,
            "maxDebugRhPolyphony": self.max_debug_rh_polyphony,
            "maxDebugLhPolyphony": self.max_debug_lh_polyphony,
            "maxStudyRhPolyphony": self.max_study_rh_polyphony,
            "maxStudyLhPolyphony": self.max_study_lh_polyphony,
        }


@dataclass
class PreparedNotation:
    cleaned_events: list[NoteEvent]
    debug_timelines: dict[str, list[TimelineEntry]]
    study_timelines: dict[str, list[TimelineEntry]]
    debug_note_events: list[NoteEvent]
    study_note_events: list[NoteEvent]
    key_signature: key.Key
    key_confidence: float
    warnings: list[str]
    metrics: dict[str, float]
    profile_name: str
    profile_settings: dict[str, float | int | str]


def build_simple_piano_profile(
    *,
    study_confidence_cutoff: float = 0.60,
    study_min_duration_ql: float = 0.28,
    onset_merge_tolerance_ql: float = 0.08,
    overlap_merge_tolerance_ql: float = 0.05,
) -> NotationProfile:
    return NotationProfile(
        name="simple-piano",
        study_confidence_cutoff=study_confidence_cutoff,
        study_min_duration_ql=study_min_duration_ql,
        onset_merge_tolerance_ql=onset_merge_tolerance_ql,
        overlap_merge_tolerance_ql=overlap_merge_tolerance_ql,
    )


def prepare_notation(
    raw_events: list[NoteEvent],
    *,
    tempo_bpm: float,
    time_signature: str,
    meter_confidence: float,
    beat_confidence: float,
    profile: NotationProfile | None = None,
) -> PreparedNotation:
    active_profile = profile or build_simple_piano_profile()
    cleaned_events = cleanup_events(raw_events, profile=active_profile)
    cleaned_events = suppress_register_outliers(cleaned_events)
    hand_assigned = assign_hands(cleaned_events)
    hand_assigned = smooth_hand_assignments(hand_assigned)

    debug_source = [
        event
        for event in hand_assigned
        if (event.confidence or 0.0) >= max(0.22, active_profile.study_confidence_cutoff - 0.18)
        and event.duration_ql >= max(0.10, active_profile.study_min_duration_ql - 0.08)
    ]
    study_source = [
        event
        for event in hand_assigned
        if (event.confidence or 0.0) >= active_profile.study_confidence_cutoff
        and event.duration_ql >= active_profile.study_min_duration_ql
    ]

    debug_step = choose_grid_unit(debug_source, mode="debug")
    study_step = choose_grid_unit(study_source, mode="study")
    if active_profile.name == "simple-piano":
        study_step = max(study_step, 0.5)
    if meter_confidence < 0.55:
        study_step = max(study_step, 0.5)

    debug_source = trim_sustain_clutter(quantize_events_to_grid(debug_source, debug_step), time_signature, mode="debug")
    study_source = trim_sustain_clutter(quantize_events_to_grid(study_source, study_step), time_signature, mode="study")
    debug_source = cap_polyphony(debug_source, RIGHT_HAND, active_profile.max_debug_rh_polyphony)
    debug_source = cap_polyphony(debug_source, LEFT_HAND, active_profile.max_debug_lh_polyphony)
    study_source = cap_polyphony(study_source, RIGHT_HAND, active_profile.max_study_rh_polyphony)
    study_source = cap_polyphony(study_source, LEFT_HAND, active_profile.max_study_lh_polyphony)

    debug_timelines = {
        RIGHT_HAND: build_hand_timeline(debug_source, RIGHT_HAND, debug_step, time_signature, mode="debug"),
        LEFT_HAND: build_hand_timeline(debug_source, LEFT_HAND, debug_step, time_signature, mode="debug"),
    }
    study_timelines = {
        RIGHT_HAND: build_hand_timeline(study_source, RIGHT_HAND, study_step, time_signature, mode="study"),
        LEFT_HAND: build_hand_timeline(study_source, LEFT_HAND, study_step, time_signature, mode="study"),
    }

    debug_note_events = timeline_to_note_events(debug_timelines)
    study_note_events = timeline_to_note_events(study_timelines)

    key_source = study_note_events or debug_note_events or cleaned_events
    key_signature, key_confidence = estimate_key_signature(key_source)

    debug_attack_count = count_attacks(debug_timelines)
    study_attack_count = count_attacks(study_timelines)
    measure_count = max(
        1,
        int(
            math.ceil(
                max(
                    max((event.start_ql + event.duration_ql for event in cleaned_events), default=0.0),
                    bar_length_quarter_length(time_signature),
                )
                / bar_length_quarter_length(time_signature)
            )
        ),
    )

    max_right_hand_polyphony = max(
        max((len(entry.pitches) for entry in debug_timelines[RIGHT_HAND]), default=0),
        max((len(entry.pitches) for entry in study_timelines[RIGHT_HAND]), default=0),
    )
    max_left_hand_polyphony = max(
        max((len(entry.pitches) for entry in debug_timelines[LEFT_HAND]), default=0),
        max((len(entry.pitches) for entry in study_timelines[LEFT_HAND]), default=0),
    )

    metrics = {
        "rawNoteCount": float(len(raw_events)),
        "cleanedNoteCount": float(len(cleaned_events)),
        "debugNoteCount": float(len(debug_note_events)),
        "studyNoteCount": float(len(study_note_events)),
        "debugAttackCount": float(debug_attack_count),
        "studyAttackCount": float(study_attack_count),
        "studyDensityPerMeasure": float(study_attack_count) / float(measure_count),
        "meterConfidence": meter_confidence,
        "beatConfidence": beat_confidence,
        "keyConfidence": key_confidence,
        "debugGridQuarterLength": debug_step,
        "studyGridQuarterLength": study_step,
        "maxRightHandPolyphony": float(max_right_hand_polyphony),
        "maxLeftHandPolyphony": float(max_left_hand_polyphony),
        "simplificationRatio": float(len(cleaned_events)) / max(1.0, float(len(study_note_events) or 1)),
        "estimatedSharps": float(key_signature.sharps),
    }

    warnings = build_notation_warnings(metrics)

    return PreparedNotation(
        cleaned_events=cleaned_events,
        debug_timelines=debug_timelines,
        study_timelines=study_timelines,
        debug_note_events=debug_note_events,
        study_note_events=study_note_events,
        key_signature=key_signature,
        key_confidence=key_confidence,
        warnings=warnings,
        metrics=metrics,
        profile_name=active_profile.name,
        profile_settings=active_profile.as_dict(),
    )


def cleanup_events(events: list[NoteEvent], *, profile: NotationProfile) -> list[NoteEvent]:
    normalized: list[NoteEvent] = []
    for event in sorted(events, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql)):
        if event.pitch < PIANO_LOW or event.pitch > PIANO_HIGH:
            continue
        if not math.isfinite(event.start_ql) or not math.isfinite(event.duration_ql):
            continue
        duration = max(0.0, min(event.duration_ql, 8.0))
        if duration < 0.08:
            continue
        normalized.append(
            NoteEvent(
                pitch=int(round(event.pitch)),
                start_ql=round(max(event.start_ql, 0.0), 4),
                duration_ql=round(duration, 4),
                velocity=max(1, min(int(round(event.velocity)), 127)),
                confidence=event.confidence,
                start_sec=event.start_sec,
                duration_sec=event.duration_sec,
            )
        )

    snapped = snap_near_simultaneous_onsets(normalized, tolerance=profile.onset_merge_tolerance_ql)
    merged = merge_overlapping_duplicates(
        snapped,
        onset_tolerance=max(0.05, profile.onset_merge_tolerance_ql),
        overlap_tolerance=max(0.03, profile.overlap_merge_tolerance_ql),
    )
    annotated = annotate_confidence(merged)

    cleaned: list[NoteEvent] = []
    for event in annotated:
        confidence = event.confidence or 0.0
        short_threshold = 0.10 if confidence >= 0.72 else profile.study_min_duration_ql
        if event.pitch < 36 and event.duration_ql < 0.35 and confidence < 0.75:
            continue
        if event.duration_ql < short_threshold and confidence < 0.55:
            continue
        cleaned.append(event)

    return annotate_confidence(
        merge_overlapping_duplicates(
            cleaned,
            onset_tolerance=max(0.05, profile.onset_merge_tolerance_ql),
            overlap_tolerance=max(0.03, profile.overlap_merge_tolerance_ql),
        )
    )


def smooth_hand_assignments(events: list[NoteEvent]) -> list[NoteEvent]:
    if not events:
        return []

    smoothed: list[NoteEvent] = []
    previous_by_pitch_class: dict[int, str] = {}
    for event in events:
        pitch_class = event.pitch % 12
        assigned_hand = event.hand or RIGHT_HAND
        previous_hand = previous_by_pitch_class.get(pitch_class)
        if previous_hand and abs(event.pitch - 60) <= 4:
            assigned_hand = previous_hand
        if assigned_hand == LEFT_HAND and event.pitch >= 61:
            assigned_hand = RIGHT_HAND
        if assigned_hand == RIGHT_HAND and event.pitch <= 54:
            assigned_hand = LEFT_HAND
        previous_by_pitch_class[pitch_class] = assigned_hand
        smoothed.append(replace(event, hand=assigned_hand))
    return smoothed


def suppress_register_outliers(events: list[NoteEvent]) -> list[NoteEvent]:
    kept: list[NoteEvent] = []
    for group in group_by_onset(events, tolerance=0.08):
        if len(group) <= 1:
            kept.extend(group)
            continue
        ordered = sorted(group, key=lambda event: event.pitch)
        median_pitch = ordered[len(ordered) // 2].pitch
        for event in ordered:
            confidence = event.confidence or 0.0
            if abs(event.pitch - median_pitch) >= 24 and confidence < 0.75 and event.duration_ql < 0.75:
                continue
            kept.append(event)
    return sorted(kept, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql))


def snap_near_simultaneous_onsets(events: list[NoteEvent], tolerance: float) -> list[NoteEvent]:
    if not events:
        return []

    snapped: list[NoteEvent] = []
    group: list[NoteEvent] = [events[0]]

    def flush(current_group: list[NoteEvent]) -> None:
        starts = [item.start_ql for item in current_group]
        snapped_start = round(float(np.median(np.asarray(starts))), 4)
        for item in current_group:
            snapped.append(replace(item, start_ql=snapped_start))

    for event in events[1:]:
        if abs(event.start_ql - group[-1].start_ql) <= tolerance:
            group.append(event)
            continue
        flush(group)
        group = [event]

    flush(group)
    return sorted(snapped, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql))


def merge_overlapping_duplicates(
    events: list[NoteEvent],
    *,
    onset_tolerance: float,
    overlap_tolerance: float,
) -> list[NoteEvent]:
    if not events:
        return []

    grouped: dict[int, list[NoteEvent]] = {}
    for event in sorted(events, key=lambda item: (item.pitch, item.start_ql, -item.duration_ql)):
        grouped.setdefault(event.pitch, []).append(event)

    merged: list[NoteEvent] = []
    for pitch_value, pitch_events in grouped.items():
        current = pitch_events[0]
        current_end = current.start_ql + current.duration_ql
        for event in pitch_events[1:]:
            event_end = event.start_ql + event.duration_ql
            same_attack = abs(event.start_ql - current.start_ql) <= onset_tolerance
            overlaps = event.start_ql <= (current_end - overlap_tolerance)
            if same_attack or overlaps:
                current_end = max(current_end, event_end)
                current = replace(
                    current,
                    duration_ql=round(current_end - current.start_ql, 4),
                    velocity=max(current.velocity, event.velocity),
                    confidence=max(current.confidence or 0.0, event.confidence or 0.0) or None,
                    duration_sec=max(current.duration_sec or 0.0, event.duration_sec or 0.0) or None,
                )
                continue
            merged.append(current)
            current = event
            current_end = event_end
        merged.append(current)

    return sorted(merged, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql))


def annotate_confidence(events: list[NoteEvent]) -> list[NoteEvent]:
    if not events:
        return []

    onset_groups = group_by_onset(events, tolerance=0.08)
    annotated: list[NoteEvent] = []
    for group in onset_groups:
        group_size = len(group)
        for event in group:
            velocity_score = clamp((event.velocity - 35) / 60.0, 0.0, 1.0)
            duration_score = clamp(event.duration_ql / 0.75, 0.0, 1.0)
            register_score = 0.4 if event.pitch < 36 or event.pitch > 96 else 0.7 if event.pitch < 40 or event.pitch > 92 else 1.0
            clutter_penalty = 1.0 / (1.0 + (0.18 * max(0, group_size - 4)))
            short_penalty = 0.7 if event.duration_ql < 0.18 else 1.0
            confidence = clamp(
                ((0.45 * velocity_score) + (0.35 * duration_score) + (0.20 * register_score))
                * clutter_penalty
                * short_penalty,
                0.05,
                0.99,
            )
            annotated.append(replace(event, confidence=round(confidence, 4)))
    return sorted(annotated, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql))


def assign_hands(events: list[NoteEvent]) -> list[NoteEvent]:
    assigned: list[NoteEvent] = []
    right_center = 67.0
    left_center = 52.0
    split_point = 60.0

    for group in group_by_onset(events, tolerance=0.001):
        notes = sorted(group, key=lambda item: item.pitch)
        left: list[NoteEvent] = []
        right: list[NoteEvent] = []
        ambiguous: list[NoteEvent] = []

        for event in notes:
            if event.pitch >= split_point + 3:
                right.append(event)
            elif event.pitch <= split_point - 3:
                left.append(event)
            else:
                ambiguous.append(event)

        for event in ambiguous:
            right_cost = abs(event.pitch - right_center) * 0.8 + max(0.0, 60.0 - event.pitch) * 1.2
            left_cost = abs(event.pitch - left_center) * 0.8 + max(0.0, event.pitch - 60.0) * 1.2

            if event.pitch >= 60:
                right_cost -= 0.75
                left_cost += 0.45
            if event.pitch <= 55:
                left_cost -= 0.75
                right_cost += 0.45

            if left and event.pitch > max(item.pitch for item in left):
                left_cost += 0.4
            if right and event.pitch < min(item.pitch for item in right):
                right_cost += 0.4

            if not right and event.pitch >= 60:
                right_cost -= 0.7
            if not left and event.pitch <= 60:
                left_cost -= 0.7

            target = RIGHT_HAND if right_cost <= left_cost else LEFT_HAND
            if target == RIGHT_HAND:
                right.append(event)
            else:
                left.append(event)

        if not right and left:
            promote = max(left, key=lambda item: item.pitch)
            if promote.pitch >= 62 or len(left) > 2:
                left.remove(promote)
                right.append(promote)
        if not left and right:
            demote = min(right, key=lambda item: item.pitch)
            if demote.pitch <= 58 or len(right) > 2:
                right.remove(demote)
                left.append(demote)

        if right:
            right_center = (0.65 * right_center) + (0.35 * mean(item.pitch for item in right))
        if left:
            left_center = (0.65 * left_center) + (0.35 * mean(item.pitch for item in left))
        split_point = clamp((right_center + left_center) / 2.0, 57.0, 63.0)

        assigned.extend(replace(item, hand=LEFT_HAND) for item in sorted(left, key=lambda note: note.pitch))
        assigned.extend(replace(item, hand=RIGHT_HAND) for item in sorted(right, key=lambda note: note.pitch))

    return sorted(assigned, key=lambda item: (item.start_ql, item.hand or "", item.pitch))


def choose_grid_unit(events: list[NoteEvent], *, mode: str) -> float:
    if not events:
        return 0.5

    candidates = [1.0, 0.5, 0.25] if mode == "study" else [0.5, 0.25]
    complexity_penalty = {
        "study": {1.0: 0.015, 0.5: 0.045, 0.25: 0.110},
        "debug": {0.5: 0.020, 0.25: 0.050},
    }

    scores: dict[float, float] = {}
    for step in candidates:
        errors: list[float] = []
        for event in events:
            weight = 0.6 + (0.4 * (event.confidence or 0.5))
            snapped_start = round(event.start_ql / step) * step
            snapped_duration = max(step, round(event.duration_ql / step) * step)
            errors.append(weight * abs(event.start_ql - snapped_start))
            errors.append(0.45 * weight * abs(event.duration_ql - snapped_duration))
        scores[step] = (float(np.mean(np.asarray(errors)))) + complexity_penalty[mode][step]

    best_score = min(scores.values())
    for step in candidates:
        if scores[step] <= best_score * 1.15:
            return step
    return min(scores, key=scores.get)


def build_hand_timeline(
    events: list[NoteEvent],
    hand: str,
    step: float,
    time_signature: str,
    *,
    mode: str,
) -> list[TimelineEntry]:
    hand_events = [event for event in events if event.hand == hand]
    if not hand_events:
        return []

    total_duration = max(event.start_ql + event.duration_ql for event in hand_events)
    slot_count = max(1, int(math.ceil(total_duration / step)))
    entries: list[TimelineEntry] = []
    previous_pitches: list[int] = []

    for slot_index in range(slot_count):
        slot = round(slot_index * step, 4)
        active = [
            event
            for event in hand_events
            if event.start_ql <= slot + 1e-6 and (event.start_ql + event.duration_ql) > slot + 1e-6
        ]
        if mode == "study":
            pitches = select_study_pitches(active, hand, slot, step, time_signature, previous_pitches)
        else:
            pitches = select_debug_pitches(active, hand, slot)

        velocity = 64
        if pitches:
            matching = [event.velocity for event in active if event.pitch in pitches]
            if matching:
                velocity = int(round(sum(matching) / len(matching)))

        if entries and entries[-1].pitches == pitches:
            entries[-1].duration_ql = round(entries[-1].duration_ql + step, 4)
        else:
            entries.append(
                TimelineEntry(
                    start_ql=slot,
                    duration_ql=step,
                    pitches=pitches,
                    hand=hand,
                    velocity=velocity,
                )
            )
        previous_pitches = pitches

    return [entry for entry in entries if entry.duration_ql > 0]


def quantize_events_to_grid(events: list[NoteEvent], step: float) -> list[NoteEvent]:
    quantized: list[NoteEvent] = []
    for event in events:
        start = round(round(event.start_ql / step) * step, 4)
        duration = round(max(step, round(event.duration_ql / step) * step), 4)
        quantized.append(replace(event, start_ql=max(0.0, start), duration_ql=duration))
    return merge_overlapping_duplicates(
        sorted(quantized, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql)),
        onset_tolerance=max(step / 2.0, 0.05),
        overlap_tolerance=max(step / 4.0, 0.03),
    )


def trim_sustain_clutter(events: list[NoteEvent], time_signature: str, *, mode: str) -> list[NoteEvent]:
    if not events:
        return []

    bar_length = bar_length_quarter_length(time_signature)
    trimmed: list[NoteEvent] = []
    for event in events:
        base_cap = bar_length if mode == "debug" else (2.0 if event.hand == RIGHT_HAND else 2.5)
        if is_strong_position(event.start_ql, time_signature, 0.25) and (event.confidence or 0.0) >= 0.75:
            base_cap += 0.5
        trimmed.append(replace(event, duration_ql=min(event.duration_ql, base_cap)))
    return merge_overlapping_duplicates(
        sorted(trimmed, key=lambda item: (item.start_ql, item.pitch, -item.duration_ql)),
        onset_tolerance=0.05,
        overlap_tolerance=0.03,
    )


def cap_polyphony(events: list[NoteEvent], hand: str, limit: int) -> list[NoteEvent]:
    if not events:
        return []

    kept: list[NoteEvent] = []
    for group in group_by_onset(events, tolerance=0.001):
        current_hand = [event for event in group if event.hand == hand]
        other_hand = [event for event in group if event.hand != hand]
        if hand == RIGHT_HAND:
            ordered = sorted(current_hand, key=lambda event: (event.pitch, event.confidence or 0.0, event.velocity), reverse=True)
        else:
            ordered = sorted(current_hand, key=lambda event: (event.pitch, -(event.confidence or 0.0), -event.velocity))
        kept.extend(ordered[:limit])
        kept.extend(other_hand)
    return sorted(
        merge_overlapping_duplicates(kept, onset_tolerance=0.05, overlap_tolerance=0.03),
        key=lambda item: (item.start_ql, item.pitch, -item.duration_ql),
    )


def select_debug_pitches(active: list[NoteEvent], hand: str, slot: float) -> list[int]:
    if not active:
        return []

    limit = 4 if hand == RIGHT_HAND else 3
    if hand == RIGHT_HAND:
        ordered = sorted(active, key=lambda event: (event.pitch, event.confidence or 0.0, event.velocity, -(slot - event.start_ql)), reverse=True)
    else:
        ordered = sorted(active, key=lambda event: (event.pitch, -(event.confidence or 0.0), -event.velocity, slot - event.start_ql))

    selected: list[int] = []
    for event in ordered:
        if event.pitch in selected:
            continue
        selected.append(event.pitch)
        if len(selected) >= limit:
            break

    return sorted(selected, reverse=(hand == RIGHT_HAND))


def select_study_pitches(
    active: list[NoteEvent],
    hand: str,
    slot: float,
    step: float,
    time_signature: str,
    previous_pitches: list[int],
) -> list[int]:
    if not active:
        return []

    recent = [event for event in active if (slot - event.start_ql) <= max(0.5, step * 2.0)] or active
    strong = is_strong_position(slot, time_signature, step)

    if hand == RIGHT_HAND:
        ordered = sorted(
            recent,
            key=lambda event: (event.pitch, event.confidence or 0.0, event.velocity, -(slot - event.start_ql)),
            reverse=True,
        )
        melody = ordered[0]
        selected = [melody.pitch]

        if strong:
            harmony_pool = [
                event.pitch
                for event in ordered[1:]
                if 3 <= (melody.pitch - event.pitch) <= 9 and event.pitch not in selected and (event.confidence or 0.0) >= 0.78
            ]
            selected.extend(harmony_pool[:1])

        if previous_pitches and not strong:
            sustained = [pitch for pitch in previous_pitches if any(event.pitch == pitch for event in active)]
            if sustained:
                for pitch_value in sustained[:1]:
                    if pitch_value not in selected:
                        selected.append(pitch_value)

        return sorted(selected, reverse=True)[:3]

    ordered = sorted(
        recent,
        key=lambda event: (event.pitch, -(event.confidence or 0.0), -event.velocity, slot - event.start_ql),
    )
    bass = ordered[0]
    selected = [bass.pitch]

    if strong:
        support_pool = [
            event.pitch
            for event in ordered[1:]
            if 4 <= (event.pitch - bass.pitch) <= 9 and event.pitch not in selected and (event.confidence or 0.0) >= 0.8
        ]
        if support_pool:
            selected.append(
                min(
                    support_pool,
                    key=lambda pitch_value: min(abs((pitch_value - bass.pitch) - 7), abs((pitch_value - bass.pitch) - 4)),
                )
            )

    if previous_pitches and not strong:
        sustained = [pitch for pitch in previous_pitches if any(event.pitch == pitch for event in active)]
        if sustained:
            selected = [sustained[0]]

    return sorted(selected)[:1 if not strong else 2]


def timeline_to_note_events(timelines: dict[str, list[TimelineEntry]]) -> list[NoteEvent]:
    events: list[NoteEvent] = []
    for hand, entries in timelines.items():
        for entry in entries:
            for pitch_value in entry.pitches:
                events.append(
                    NoteEvent(
                        pitch=pitch_value,
                        start_ql=entry.start_ql,
                        duration_ql=entry.duration_ql,
                        velocity=entry.velocity,
                        confidence=1.0,
                        hand=hand,
                    )
                )
    return sorted(events, key=lambda item: (item.start_ql, item.pitch))


def estimate_key_signature(events: list[NoteEvent]) -> tuple[key.Key, float]:
    if not events:
        return key.KeySignature(0).asKey("major"), 0.0

    histogram = np.zeros(12)
    for event in events:
        weight = min(event.duration_ql, 4.0) * (0.7 + (0.3 * (event.confidence or 0.5)))
        histogram[event.pitch % 12] += weight

    if histogram.sum() <= 0:
        return key.KeySignature(0).asKey("major"), 0.0

    histogram = histogram / histogram.sum()
    candidates: list[tuple[float, key.Key]] = []
    for sharps in range(-4, 5):
        for mode in ("major", "minor"):
            candidate = key.KeySignature(sharps).asKey(mode)
            profile = MAJOR_PROFILE if mode == "major" else MINOR_PROFILE
            rotated = np.roll(profile, candidate.tonic.pitchClass)
            rotated = rotated / rotated.sum()
            score = float(np.corrcoef(histogram, rotated)[0, 1])
            candidates.append((score, candidate))

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, best_key = candidates[0]
    second_score = candidates[1][0] if len(candidates) > 1 else -1.0
    confidence = clamp((best_score + 1.0) / 2.0, 0.0, 1.0)
    confidence = clamp(confidence * 0.7 + clamp(best_score - second_score, 0.0, 1.0) * 0.3, 0.0, 1.0)
    return best_key, confidence


def spell_pitch_name(midi_value: int, key_signature: key.Key) -> str:
    pitch_class = midi_value % 12
    octave = (midi_value // 12) - 1
    if pitch_class in NATURAL_PITCH_NAMES:
        return f"{NATURAL_PITCH_NAMES[pitch_class]}{octave}"

    if key_signature.sharps < 0:
        names = FLAT_PITCH_NAMES
    elif key_signature.sharps > 0:
        names = SHARP_PITCH_NAMES
    else:
        names = NEUTRAL_PITCH_NAMES
    return f"{names[pitch_class]}{octave}"


def build_notation_warnings(metrics: dict[str, float]) -> list[str]:
    warnings: list[str] = []
    if metrics.get("meterConfidence", 1.0) < 0.55:
        warnings.append("Meter confidence is low, so the notation uses a readability-first fallback meter.")
    if metrics.get("keyConfidence", 1.0) < 0.45:
        warnings.append("Pitch spelling confidence is limited, so some accidentals may still need manual cleanup.")
    if metrics.get("studyDensityPerMeasure", 0.0) > 8.0:
        warnings.append("The study-friendly notation is still dense and should be treated as a guided draft, not polished engraving.")
    if metrics.get("maxRightHandPolyphony", 0.0) > 3.0 or metrics.get("maxLeftHandPolyphony", 0.0) > 2.0:
        warnings.append("Some chords remain thicker than ideal for beginner piano reading.")
    return warnings


def count_attacks(timelines: dict[str, list[TimelineEntry]]) -> int:
    return sum(1 for entries in timelines.values() for entry in entries if entry.pitches)


def group_by_onset(events: list[NoteEvent], *, tolerance: float) -> list[list[NoteEvent]]:
    if not events:
        return []

    groups: list[list[NoteEvent]] = []
    current_group: list[NoteEvent] = [events[0]]
    for event in events[1:]:
        if abs(event.start_ql - current_group[-1].start_ql) <= tolerance:
            current_group.append(event)
            continue
        groups.append(current_group)
        current_group = [event]
    groups.append(current_group)
    return groups


def bar_length_quarter_length(time_signature: str) -> float:
    numerator, denominator = time_signature.split("/")
    return (int(numerator) * 4.0) / int(denominator)


def strong_positions_for_signature(time_signature: str) -> list[float]:
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


def is_strong_position(offset: float, time_signature: str, step: float) -> bool:
    bar_length = bar_length_quarter_length(time_signature)
    beat_position = offset % bar_length
    tolerance = max(step / 2.0, 0.2)
    for strong_position in strong_positions_for_signature(time_signature):
        if abs(beat_position - strong_position) <= tolerance:
            return True
    return False


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
