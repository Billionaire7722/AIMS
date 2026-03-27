import type { EditableScoreResponse, EditableScoreSaveInput, ScoreHand, ScoreMeasure, ScoreNote } from "@aims/shared-types";
import {
  measureLengthBeats,
  normalizeEditableScore,
  scoreToPlaybackEvents,
  scientificPitchToMidi,
} from "@aims/music-domain";

export type Tool = "select" | "note" | "rest" | "delete";
export type AccidentalPreference = "natural" | "sharp" | "flat";
export type LoopMode = "off" | "measure" | "range";
export type DurationValue = 4 | 2 | 1 | 0.5 | 0.25;

export const DURATION_OPTIONS: Array<{ label: string; value: DurationValue }> = [
  { label: "Whole", value: 4 },
  { label: "Half", value: 2 },
  { label: "Quarter", value: 1 },
  { label: "Eighth", value: 0.5 },
  { label: "16th", value: 0.25 },
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NATURAL_NAMES: Record<number, string> = {
  0: "C",
  2: "D",
  4: "E",
  5: "F",
  7: "G",
  9: "A",
  11: "B",
};

export function cloneScore(score: EditableScoreResponse): EditableScoreResponse {
  return structuredClone(score);
}

export function normalizeScore(score: EditableScoreResponse): EditableScoreResponse {
  const normalized = normalizeEditableScore(score);
  return {
    ...normalized,
    assets: score.assets,
  };
}

export function clearAssets(score: EditableScoreResponse): EditableScoreResponse {
  return {
    ...score,
    assets: { musicxmlUrl: null, midiUrl: null },
  };
}

export function toSavePayload(score: EditableScoreResponse): EditableScoreSaveInput {
  const { assets: _assets, ...payload } = score;
  return payload;
}

export function findNote(score: EditableScoreResponse, noteId: string | null) {
  if (!noteId) {
    return null;
  }
  for (const measure of score.measures) {
    const right = measure.rightHandNotes.find((note) => note.id === noteId);
    if (right) {
      return right;
    }
    const left = measure.leftHandNotes.find((note) => note.id === noteId);
    if (left) {
      return left;
    }
  }
  return null;
}

export function updateNote(
  score: EditableScoreResponse,
  noteId: string,
  updater: (note: ScoreNote) => ScoreNote,
) {
  const next = cloneScore(score);
  for (const measure of next.measures) {
    const rightIndex = measure.rightHandNotes.findIndex((note) => note.id === noteId);
    if (rightIndex >= 0) {
      measure.rightHandNotes[rightIndex] = updater(measure.rightHandNotes[rightIndex]);
      return normalizeScore(next);
    }
    const leftIndex = measure.leftHandNotes.findIndex((note) => note.id === noteId);
    if (leftIndex >= 0) {
      measure.leftHandNotes[leftIndex] = updater(measure.leftHandNotes[leftIndex]);
      return normalizeScore(next);
    }
  }
  return score;
}

export function removeNote(score: EditableScoreResponse, noteId: string) {
  const next = cloneScore(score);
  for (const measure of next.measures) {
    const rightIndex = measure.rightHandNotes.findIndex((note) => note.id === noteId);
    if (rightIndex >= 0) {
      measure.rightHandNotes.splice(rightIndex, 1);
      return normalizeScore(next);
    }
    const leftIndex = measure.leftHandNotes.findIndex((note) => note.id === noteId);
    if (leftIndex >= 0) {
      measure.leftHandNotes.splice(leftIndex, 1);
      return normalizeScore(next);
    }
  }
  return score;
}

export function replaceNoteHand(score: EditableScoreResponse, noteId: string, hand: ScoreHand) {
  return updateNote(score, noteId, (note) => ({ ...note, hand, source: "user" }));
}

export function replaceNoteDuration(score: EditableScoreResponse, noteId: string, durationBeats: number) {
  return updateNote(score, noteId, (note) => ({ ...note, durationBeats: Math.max(0.25, durationBeats), source: "user" }));
}

export function mergeChord(score: EditableScoreResponse, noteId: string) {
  const note = findNote(score, noteId);
  if (!note) {
    return score;
  }
  const chordId = note.chordId ?? crypto.randomUUID();
  return updateByOnset(score, note.measureNumber, note.hand, note.startBeat, (item) => ({
    ...item,
    chordId,
    source: "user",
  }));
}

export function splitChord(score: EditableScoreResponse, noteId: string) {
  const note = findNote(score, noteId);
  if (!note) {
    return score;
  }
  return updateByOnset(score, note.measureNumber, note.hand, note.startBeat, (item) => ({
    ...item,
    chordId: null,
    source: "user",
  }));
}

export function replaceNotePitch(score: EditableScoreResponse, noteId: string, midiValue: number, preference: AccidentalPreference) {
  return updateNote(score, noteId, (note) => ({
    ...note,
    midiValue,
    pitch: spellMidi(midiValue, preference),
    accidental: preference,
    source: "user",
  }));
}

export function replaceNoteAccidental(score: EditableScoreResponse, noteId: string, accidental: AccidentalPreference) {
  return updateNote(score, noteId, (note) => ({
    ...note,
    pitch: spellMidi(note.midiValue, accidental),
    accidental,
    source: "user",
  }));
}

export function toggleTieStart(score: EditableScoreResponse, noteId: string) {
  return updateNote(score, noteId, (note) => ({
    ...note,
    tieFlags: { start: !note.tieFlags.start, stop: note.tieFlags.stop },
    source: "user",
  }));
}

export function toggleTieStop(score: EditableScoreResponse, noteId: string) {
  return updateNote(score, noteId, (note) => ({
    ...note,
    tieFlags: { start: note.tieFlags.start, stop: !note.tieFlags.stop },
    source: "user",
  }));
}

export function moveNoteToMeasure(score: EditableScoreResponse, noteId: string, measureNumber: number) {
  const note = findNote(score, noteId);
  if (!note) {
    return score;
  }
  const next = removeNote(score, noteId);
  const measure = next.measures.find((item) => item.number === measureNumber);
  if (!measure) {
    return score;
  }
  const moved = { ...note, measureNumber, source: "user" as const };
  if (moved.hand === "rh") {
    measure.rightHandNotes.push(moved);
  } else {
    measure.leftHandNotes.push(moved);
  }
  return normalizeScore(next);
}

export function addNote(
  score: EditableScoreResponse,
  measureNumber: number,
  hand: ScoreHand,
  startBeat: number,
  durationBeats: number,
  midiValue: number,
  preference: AccidentalPreference,
) {
  const next = cloneScore(score);
  const measure = next.measures.find((item) => item.number === measureNumber);
  if (!measure) {
    return score;
  }
  const note: ScoreNote = {
    id: crypto.randomUUID(),
    measureNumber,
    hand,
    pitch: spellMidi(midiValue, preference),
    midiValue,
    startBeat,
    durationBeats,
    accidental: preference,
    tieFlags: { start: false, stop: false },
    chordId: null,
    source: "user",
    confidence: 1,
    isRest: false,
  };
  if (hand === "rh") {
    measure.rightHandNotes.push(note);
  } else {
    measure.leftHandNotes.push(note);
  }
  return normalizeScore(next);
}

export function addRest(
  score: EditableScoreResponse,
  measureNumber: number,
  hand: ScoreHand,
  startBeat: number,
  durationBeats: number,
) {
  const next = cloneScore(score);
  const measure = next.measures.find((item) => item.number === measureNumber);
  if (!measure) {
    return score;
  }
  const note: ScoreNote = {
    id: crypto.randomUUID(),
    measureNumber,
    hand,
    pitch: "Rest",
    midiValue: 0,
    startBeat,
    durationBeats,
    accidental: null,
    tieFlags: { start: false, stop: false },
    chordId: null,
    source: "user",
    confidence: 1,
    isRest: true,
  };
  if (hand === "rh") {
    measure.rightHandNotes.push(note);
  } else {
    measure.leftHandNotes.push(note);
  }
  return normalizeScore(next);
}

export function addMeasureAfter(score: EditableScoreResponse) {
  const next = cloneScore(score);
  const beatsPerMeasure = measureLengthBeats(next.timeSignature);
  next.measures.push({
    number: next.measures.length + 1,
    startBeat: beatsPerMeasure * next.measures.length,
    beatsPerMeasure,
    timeSignature: next.timeSignature,
    rightHandNotes: [],
    leftHandNotes: [],
    repeatStart: false,
    repeatEnd: false,
    barline: "single",
  });
  next.measureCount = next.measures.length;
  return normalizeScore(next);
}

export function duplicateMeasure(score: EditableScoreResponse, measureNumber: number) {
  const source = score.measures.find((item) => item.number === measureNumber);
  if (!source) {
    return score;
  }
  const next = cloneScore(score);
  const beatsPerMeasure = measureLengthBeats(next.timeSignature);
  const cloneMeasure = structuredClone(source);
  cloneMeasure.number = next.measures.length + 1;
  cloneMeasure.startBeat = beatsPerMeasure * next.measures.length;
  const suffix = crypto.randomUUID().slice(0, 6);
  cloneMeasure.rightHandNotes = cloneMeasure.rightHandNotes.map((note) => ({
    ...note,
    id: `${note.id}-${suffix}`,
    measureNumber: cloneMeasure.number,
  }));
  cloneMeasure.leftHandNotes = cloneMeasure.leftHandNotes.map((note) => ({
    ...note,
    id: `${note.id}-${suffix}`,
    measureNumber: cloneMeasure.number,
  }));
  next.measures.push(cloneMeasure);
  next.measureCount = next.measures.length;
  return normalizeScore(next);
}

export function toggleRepeatStart(score: EditableScoreResponse, measureNumber: number) {
  return updateMeasure(score, measureNumber, (measure) => ({
    ...measure,
    repeatStart: !measure.repeatStart,
    barline: !measure.repeatStart ? "repeat-start" : "single",
  }));
}

export function toggleRepeatEnd(score: EditableScoreResponse, measureNumber: number) {
  return updateMeasure(score, measureNumber, (measure) => ({
    ...measure,
    repeatEnd: !measure.repeatEnd,
    barline: !measure.repeatEnd ? "repeat-end" : "single",
  }));
}

export function updateMeasure(score: EditableScoreResponse, measureNumber: number, updater: (measure: ScoreMeasure) => ScoreMeasure) {
  const next = cloneScore(score);
  const index = next.measures.findIndex((measure) => measure.number === measureNumber);
  if (index < 0) {
    return score;
  }
  next.measures[index] = updater(next.measures[index]);
  return normalizeScore(next);
}

export function scoreToBeatRange(score: EditableScoreResponse, measureNumber: number) {
  const measure = score.measures.find((item) => item.number === measureNumber);
  return {
    start: measure?.startBeat ?? 0,
    end: (measure?.startBeat ?? 0) + (measure?.beatsPerMeasure ?? measureLengthBeats(score.timeSignature)),
  };
}

export function measureForBeat(score: EditableScoreResponse, beat: number) {
  return score.measures.find((measure) => beat >= measure.startBeat && beat < measure.startBeat + measure.beatsPerMeasure)
    ?? score.measures[score.measures.length - 1]
    ?? null;
}

export function scorePlaybackEvents(score: EditableScoreResponse) {
  return scoreToPlaybackEvents(score);
}

export function pitchFromMidi(midi: number, preference: AccidentalPreference) {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const pitchClass = clamped % 12;
  const octave = Math.floor(clamped / 12) - 1;
  if (NATURAL_NAMES[pitchClass]) {
    return `${NATURAL_NAMES[pitchClass]}${octave}`;
  }
  if (preference === "flat") {
    return `${FLAT_NAMES[pitchClass]}${octave}`;
  }
  return `${SHARP_NAMES[pitchClass]}${octave}`;
}

export function midiFromPitch(pitch: string) {
  return scientificPitchToMidi(pitch) ?? 60;
}

export function getDurationLabel(duration: number) {
  if (duration >= 4) {
    return "Whole";
  }
  if (duration >= 2) {
    return "Half";
  }
  if (duration >= 1) {
    return "Quarter";
  }
  if (duration >= 0.5) {
    return "Eighth";
  }
  return "16th";
}

export function snapBeat(value: number, step = 0.25) {
  return Math.max(0, Math.round(value / step) * step);
}

function updateByOnset(
  score: EditableScoreResponse,
  measureNumber: number,
  hand: ScoreHand,
  startBeat: number,
  updater: (note: ScoreNote) => ScoreNote,
) {
  const next = cloneScore(score);
  const measure = next.measures.find((item) => item.number === measureNumber);
  if (!measure) {
    return score;
  }
  const bucket = hand === "rh" ? measure.rightHandNotes : measure.leftHandNotes;
  const updated = bucket.map((item) => (Math.abs(item.startBeat - startBeat) <= 0.001 ? updater(item) : item));
  if (hand === "rh") {
    measure.rightHandNotes = updated;
  } else {
    measure.leftHandNotes = updated;
  }
  return normalizeScore(next);
}

function spellMidi(midi: number, preference: AccidentalPreference) {
  return pitchFromMidi(midi, preference);
}
