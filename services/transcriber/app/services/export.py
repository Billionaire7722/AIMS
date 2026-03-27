from pathlib import Path

import music21

from app.services.analysis import NoteEvent
from app.services.notation import LEFT_HAND, RIGHT_HAND, TimelineEntry, spell_pitch_name


def build_piano_score(
    *,
    right_hand: list[TimelineEntry],
    left_hand: list[TimelineEntry],
    tempo_bpm: float,
    time_signature: str,
    key_signature: music21.key.Key,
    title: str,
) -> music21.stream.Score:
    score = music21.stream.Score(id="AIMS")
    score.metadata = music21.metadata.Metadata()
    score.metadata.title = title

    right_part = music21.stream.PartStaff(id="PianoRH")
    right_part.partName = "Piano RH"
    right_part.partAbbreviation = "RH"
    right_part.insert(0, music21.instrument.Piano())
    right_part.insert(0, music21.clef.TrebleClef())
    right_part.insert(0, music21.key.KeySignature(key_signature.sharps))
    right_part.insert(0, music21.meter.TimeSignature(time_signature))
    right_part.insert(0, music21.tempo.MetronomeMark(number=tempo_bpm))
    append_timeline(right_part, right_hand, key_signature, RIGHT_HAND)

    left_part = music21.stream.PartStaff(id="PianoLH")
    left_part.partName = "Piano LH"
    left_part.partAbbreviation = "LH"
    left_part.insert(0, music21.instrument.Piano())
    left_part.insert(0, music21.clef.BassClef())
    left_part.insert(0, music21.key.KeySignature(key_signature.sharps))
    left_part.insert(0, music21.meter.TimeSignature(time_signature))
    left_part.insert(0, music21.tempo.MetronomeMark(number=tempo_bpm))
    append_timeline(left_part, left_hand, key_signature, LEFT_HAND)

    score.insert(0, right_part)
    score.insert(0, left_part)
    score.insert(
        0,
        music21.layout.StaffGroup(
            [right_part, left_part],
            name="Piano",
            abbreviation="Pno.",
            symbol="brace",
            barTogether=True,
        ),
    )

    score.makeMeasures(inPlace=True)
    score.makeTies(inPlace=True)
    score.makeBeams(inPlace=True)
    score.makeAccidentals(inPlace=True)
    return score


def append_timeline(
    part: music21.stream.PartStaff,
    timeline: list[TimelineEntry],
    key_signature: music21.key.Key,
    hand: str,
) -> None:
    for entry in timeline:
        element = build_element(entry, key_signature, hand)
        part.append(element)


def build_element(
    entry: TimelineEntry,
    key_signature: music21.key.Key,
    hand: str,
) -> music21.base.Music21Object:
    if not entry.pitches:
        rest = music21.note.Rest()
        rest.quarterLength = entry.duration_ql
        return rest

    spelled_pitches = [spell_pitch_name(pitch_value, key_signature) for pitch_value in entry.pitches]
    if len(spelled_pitches) == 1:
        note = music21.note.Note(spelled_pitches[0])
        note.volume.velocity = entry.velocity
        note.quarterLength = entry.duration_ql
        return note

    chord = music21.chord.Chord(spelled_pitches)
    chord.volume.velocity = entry.velocity
    chord.quarterLength = entry.duration_ql
    return chord


def export_score(score: music21.stream.Score, output_dir: Path, mode: str) -> tuple[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    musicxml_path = output_dir / f"{mode}.musicxml"
    midi_path = output_dir / f"{mode}.mid"
    score.write("musicxml", fp=str(musicxml_path))
    score.write("midi", fp=str(midi_path))
    return musicxml_path.name, midi_path.name


def score_to_json(events: list[NoteEvent]) -> list[dict[str, float | int | str]]:
    payload: list[dict[str, float | int | str]] = []
    for event in events:
        item: dict[str, float | int | str] = {
            "pitch": event.pitch,
            "startQl": event.start_ql,
            "durationQl": event.duration_ql,
            "velocity": event.velocity,
        }
        if event.confidence is not None:
            item["confidence"] = round(event.confidence, 4)
        if event.hand:
            item["hand"] = event.hand
        payload.append(item)
    return payload
