import {
  EditableScore,
  ScoreHand,
  ScoreMeasure,
  ScoreNote,
  ScoreSource,
  ScoreVariant,
  OutputMode,
} from "@aims/shared-types";

export type PitchRange = {
  lowest: string;
  highest: string;
};

export type RawDraftNote = {
  pitch: number;
  startQl: number;
  durationQl: number;
  velocity: number;
  confidence?: number | null;
  hand?: ScoreHand | null;
};

export type BuildScoreInput = {
  jobId: string;
  title: string;
  tempoBpm: number;
  timeSignature: string;
  keySignature: string;
  sourceMode: OutputMode;
  rawNotes: RawDraftNote[];
  variant?: ScoreVariant;
};

export type PlaybackEvent = {
  id: string;
  measureNumber: number;
  hand: ScoreHand;
  midiValue: number;
  startBeat: number;
  durationBeats: number;
  chordId: string | null;
  isRest: boolean;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const META_EVENT = 0xff;
const TICKS_PER_BEAT = 480;
const DEFAULT_VARIANT: ScoreVariant = "ai-draft";

export function midiToScientificPitch(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const note = NOTE_NAMES[clamped % 12];
  const octave = Math.floor(clamped / 12) - 1;
  return `${note}${octave}`;
}

export function scientificPitchToMidi(pitch: string): number | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch.trim());
  if (!match) {
    return null;
  }
  const [, letter, accidental, octaveString] = match;
  const octave = Number(octaveString);
  const baseMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let value = baseMap[letter];
  if (accidental === "#") {
    value += 1;
  } else if (accidental === "b") {
    value -= 1;
  }
  return (octave + 1) * 12 + value;
}

export function clampPitchName(pitch: string | null | undefined, fallback = "C4"): string {
  return pitch && pitch.length > 0 ? pitch : fallback;
}

export function formatSectionLabel(startMeasure: number, endMeasure: number): string {
  if (startMeasure === endMeasure) {
    return `m.${startMeasure}`;
  }
  return `m.${startMeasure}-m.${endMeasure}`;
}

export function summarizePitchRange(lowestMidi: number, highestMidi: number): PitchRange {
  return {
    lowest: midiToScientificPitch(lowestMidi),
    highest: midiToScientificPitch(highestMidi),
  };
}

export function parseTimeSignature(timeSignature: string) {
  const [numeratorText, denominatorText] = timeSignature.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return { numerator: 4, denominator: 4, beatsPerMeasure: 4 };
  }
  return {
    numerator,
    denominator,
    beatsPerMeasure: (numerator * 4) / denominator,
  };
}

export function measureLengthBeats(timeSignature: string): number {
  return parseTimeSignature(timeSignature).beatsPerMeasure;
}

export function handForMidi(midiValue: number): ScoreHand {
  return midiValue >= 60 ? "rh" : "lh";
}

export function createNoteId(prefix: string, measureNumber: number, hand: ScoreHand, index: number) {
  return `${prefix}-${measureNumber}-${hand}-${index}`;
}

export function scorePitchToAccidental(pitch: string): ScoreNote["accidental"] {
  if (pitch.includes("##")) {
    return "double-sharp";
  }
  if (pitch.includes("bb")) {
    return "double-flat";
  }
  if (pitch.includes("#")) {
    return "sharp";
  }
  if (pitch.includes("b")) {
    return "flat";
  }
  return "natural";
}

export function splitNoteAcrossMeasures(note: RawDraftNote, timeSignature: string): ScoreNote[] {
  const measureLength = measureLengthBeats(timeSignature);
  const segments: ScoreNote[] = [];
  const midiValue = Math.max(0, Math.min(127, Math.round(note.pitch)));
  const totalDuration = Math.max(0.125, note.durationQl);
  const sourceHand = note.hand ?? handForMidi(midiValue);
  const source: ScoreSource = "ai";
  let remaining = totalDuration;
  let currentStart = Math.max(0, note.startQl);
  let segmentIndex = 0;

  while (remaining > 0.0001) {
    const measureNumber = Math.floor(currentStart / measureLength) + 1;
    const measureStart = (measureNumber - 1) * measureLength;
    const localStartBeat = roundTo(currentStart - measureStart, 4);
    const available = Math.max(0.125, measureLength - localStartBeat);
    const durationBeats = roundTo(Math.min(remaining, available), 4);
    const pitch = midiToScientificPitch(midiValue);
    const willContinue = remaining - durationBeats > 0.0001;
    segments.push({
      id: createNoteId("note", measureNumber, sourceHand, segmentIndex),
      measureNumber,
      hand: sourceHand,
      pitch,
      midiValue,
      startBeat: localStartBeat,
      durationBeats,
      accidental: scorePitchToAccidental(pitch),
      tieFlags: {
        start: segmentIndex === 0 && willContinue,
        stop: segmentIndex > 0,
      },
      chordId: null,
      source,
      confidence: note.confidence ?? null,
      isRest: false,
    });
    remaining = roundTo(remaining - durationBeats, 4);
    currentStart = roundTo(currentStart + durationBeats, 4);
    segmentIndex += 1;
  }

  return segments;
}

export function buildEditableScoreDraft(input: BuildScoreInput): EditableScore {
  const measuresMap = new Map<number, { rh: ScoreNote[]; lh: ScoreNote[] }>();
  const notes = [...input.rawNotes]
    .filter((note) => Number.isFinite(note.pitch) && Number.isFinite(note.startQl) && Number.isFinite(note.durationQl))
    .sort((left, right) => (left.startQl - right.startQl) || (left.pitch - right.pitch));

  for (const note of notes) {
    for (const segment of splitNoteAcrossMeasures(note, input.timeSignature)) {
      const measure = measuresMap.get(segment.measureNumber) ?? { rh: [], lh: [] };
      const group = segment.hand === "rh" ? measure.rh : measure.lh;
      group.push(segment);
      measuresMap.set(segment.measureNumber, measure);
    }
  }

  const measureCount = Math.max(1, ...Array.from(measuresMap.keys(), (value) => value));
  const beatsPerMeasure = measureLengthBeats(input.timeSignature);
  const measures: ScoreMeasure[] = [];

  for (let number = 1; number <= measureCount; number += 1) {
    const existing = measuresMap.get(number) ?? { rh: [], lh: [] };
    const rightHandNotes = assignChordGroups(existing.rh.sort(compareNotes));
    const leftHandNotes = assignChordGroups(existing.lh.sort(compareNotes));
    measures.push({
      number,
      startBeat: roundTo((number - 1) * beatsPerMeasure, 4),
      beatsPerMeasure,
      timeSignature: input.timeSignature,
      rightHandNotes,
      leftHandNotes,
      repeatStart: false,
      repeatEnd: false,
      barline: "single",
    });
  }

  const now = new Date().toISOString();
  return {
    id: input.jobId,
    jobId: input.jobId,
    title: input.title,
    sourceMode: input.sourceMode,
    variant: input.variant ?? DEFAULT_VARIANT,
    tempoBpm: input.tempoBpm,
    timeSignature: input.timeSignature,
    keySignature: input.keySignature,
    measureCount,
    version: 1,
    createdAt: now,
    updatedAt: now,
    measures,
  };
}

export function normalizeEditableScore(score: EditableScore): EditableScore {
  const beatsPerMeasure = measureLengthBeats(score.timeSignature);
  const measures = score.measures.map((measure, index) => {
    const number = index + 1;
    const rightHandNotes = assignChordGroups(
      [...measure.rightHandNotes]
        .map((note) => ({ ...note, measureNumber: number, hand: "rh" as const }))
        .sort(compareNotes),
    );
    const leftHandNotes = assignChordGroups(
      [...measure.leftHandNotes]
        .map((note) => ({ ...note, measureNumber: number, hand: "lh" as const }))
        .sort(compareNotes),
    );
    return {
      ...measure,
      number,
      startBeat: roundTo(index * beatsPerMeasure, 4),
      beatsPerMeasure,
      rightHandNotes,
      leftHandNotes,
    };
  });

  return {
    ...score,
    version: Math.max(0, score.version),
    measureCount: measures.length,
    measures,
    updatedAt: new Date().toISOString(),
  };
}

export function scoreToPlaybackEvents(score: EditableScore): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];
  for (const measure of score.measures) {
    for (const note of [...measure.rightHandNotes, ...measure.leftHandNotes]) {
      if (note.isRest) {
        continue;
      }
      events.push({
        id: note.id,
        measureNumber: note.measureNumber,
        hand: note.hand,
        midiValue: note.midiValue,
        startBeat: measure.startBeat + note.startBeat,
        durationBeats: note.durationBeats,
        chordId: note.chordId ?? null,
        isRest: false,
      });
    }
  }
  return events.sort((left, right) => (left.startBeat - right.startBeat) || (left.midiValue - right.midiValue));
}

export function scoreToMusicXml(score: EditableScore): string {
  const parts = [
    buildMusicXmlPart(score, "P1", "Piano RH", "RH", score.measures.map((measure) => measure.rightHandNotes)),
    buildMusicXmlPart(score, "P2", "Piano LH", "LH", score.measures.map((measure) => measure.leftHandNotes)),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<score-partwise version="3.1" xmlns="http://www.musicxml.org/ns/musicxml">',
    "  <work>",
    `    <work-title>${escapeXml(score.title)}</work-title>`,
    "  </work>",
    "  <identification>",
    "    <creator type=\"composer\">AIMS</creator>",
    "  </identification>",
    "  <part-list>",
    '    <score-part id="P1">',
    "      <part-name>Piano RH</part-name>",
    "    </score-part>",
    '    <score-part id="P2">',
    "      <part-name>Piano LH</part-name>",
    "    </score-part>",
    "  </part-list>",
    parts[0],
    parts[1],
    "</score-partwise>",
    "",
  ].join("\n");
}

export function scoreToMidiBytes(score: EditableScore): Uint8Array {
  const tempoMicroseconds = Math.max(1, Math.round(60_000_000 / score.tempoBpm));
  const { numerator, denominator } = parseTimeSignature(score.timeSignature);
  const trackEvents: Array<{ tick: number; order: number; bytes: number[] }> = [];

  trackEvents.push({ tick: 0, order: 0, bytes: [META_EVENT, 0x51, 0x03, (tempoMicroseconds >> 16) & 0xff, (tempoMicroseconds >> 8) & 0xff, tempoMicroseconds & 0xff] });
  trackEvents.push({ tick: 0, order: 1, bytes: [META_EVENT, 0x58, 0x04, numerator & 0xff, log2Denominator(denominator) & 0xff, 24, 8] });

  for (const event of scoreToPlaybackEvents(score)) {
    const startTick = Math.max(0, Math.round(event.startBeat * TICKS_PER_BEAT));
    const endTick = Math.max(startTick + 1, Math.round((event.startBeat + event.durationBeats) * TICKS_PER_BEAT));
    const channel = event.hand === "rh" ? 0 : 1;
    trackEvents.push({ tick: startTick, order: 2, bytes: [NOTE_ON | channel, event.midiValue & 0x7f, 96] });
    trackEvents.push({ tick: endTick, order: 0, bytes: [NOTE_OFF | channel, event.midiValue & 0x7f, 64] });
  }

  trackEvents.sort((left, right) => (left.tick - right.tick) || (left.order - right.order));
  const trackData: number[] = [];
  let previousTick = 0;
  for (const event of trackEvents) {
    const delta = event.tick - previousTick;
    trackData.push(...encodeVarLen(delta), ...event.bytes);
    previousTick = event.tick;
  }
  trackData.push(0x00, META_EVENT, 0x2f, 0x00);

  const header = [
    ...asciiBytes("MThd"),
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (TICKS_PER_BEAT >> 8) & 0xff,
    TICKS_PER_BEAT & 0xff,
  ];
  const trackChunk = [
    ...asciiBytes("MTrk"),
    ...int32ToBytes(trackData.length),
    ...trackData,
  ];
  return new Uint8Array([...header, ...trackChunk]);
}

export function scoreToMidiBase64(score: EditableScore): string {
  return toBase64(scoreToMidiBytes(score));
}

function buildMusicXmlPart(
  score: EditableScore,
  partId: "P1" | "P2",
  partName: string,
  clefSign: "RH" | "LH",
  noteGroups: ScoreNote[][],
) {
  const measures = score.measures
    .map((measure, index) => {
      const notes = noteGroups[index] ?? [];
      const attributeLines = index === 0
        ? [
            "      <attributes>",
            "        <divisions>480</divisions>",
            `        <key><fifths>${keySignatureToFifths(score.keySignature)}</fifths></key>`,
            `        <time><beats>${measure.timeSignature.split("/")[0]}</beats><beat-type>${measure.timeSignature.split("/")[1]}</beat-type></time>`,
            `        <clef><sign>${clefSign === "RH" ? "G" : "F"}</sign><line>${clefSign === "RH" ? 2 : 4}</line></clef>`,
            "      </attributes>",
          ]
        : [];
      const noteLines = renderMusicXmlNotes(notes, measure);
      const barline = measure.repeatEnd
        ? "      <barline location=\"right\"><bar-style>light-heavy</bar-style><repeat direction=\"backward\"/></barline>"
        : measure.repeatStart
          ? "      <barline location=\"left\"><bar-style>heavy-light</bar-style><repeat direction=\"forward\"/></barline>"
          : "";

      return [
        `    <measure number="${measure.number}">`,
        ...attributeLines,
        ...noteLines,
        barline,
        "    </measure>",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    })
    .join("\n");

  return [
    `  <part id="${partId}">`,
    measures,
    "  </part>",
  ].join("\n");
}

function renderMusicXmlNotes(notes: ScoreNote[], measure: ScoreMeasure): string[] {
  const lines: string[] = [];
  const measureLength = measure.beatsPerMeasure;
  const ordered = [...notes].sort(compareNotes);
  let cursor = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const note = ordered[index];
    const start = roundTo(note.startBeat, 4);
    if (note.isRest) {
      if (start > cursor + 0.0001) {
        lines.push(renderRestNote(start - cursor));
      }
      lines.push(renderRestNote(note.durationBeats));
      cursor = Math.max(cursor, start + note.durationBeats);
      continue;
    }
    if (start > cursor + 0.0001) {
      lines.push(renderRestNote(start - cursor));
    }
    const sameOnset = ordered.filter((candidate) => Math.abs(candidate.startBeat - start) <= 0.0001);
    for (const chordNote of sameOnset) {
      if (chordNote.isRest) {
        lines.push(renderRestNote(chordNote.durationBeats));
      } else {
        lines.push(renderPitchNote(chordNote, chordNote !== sameOnset[0]));
      }
    }
    const groupDuration = Math.max(...sameOnset.map((candidate) => candidate.durationBeats));
    cursor = Math.max(cursor, start + groupDuration);
    index += Math.max(0, sameOnset.length - 1);
  }

  if (cursor < measureLength - 0.0001) {
    lines.push(renderRestNote(measureLength - cursor));
  }

  return lines;
}

function renderPitchNote(note: ScoreNote, addChordTag: boolean) {
  const duration = Math.max(1, Math.round(note.durationBeats * TICKS_PER_BEAT));
  const pitch = scientificPitchToMusicXml(note.pitch);
  const tieStart = note.tieFlags?.start ? "        <tie type=\"start\"/>" : "";
  const tieStop = note.tieFlags?.stop ? "        <tie type=\"stop\"/>" : "";
  return [
    "      <note>",
    addChordTag ? "        <chord/>" : "",
    "        <pitch>",
    `          <step>${pitch.step}</step>`,
    pitch.alter !== null ? `          <alter>${pitch.alter}</alter>` : "",
    `          <octave>${pitch.octave}</octave>`,
    "        </pitch>",
    `        <duration>${duration}</duration>`,
    `        <type>${musicXmlDurationType(note.durationBeats)}</type>`,
    tieStart,
    tieStop,
    "      </note>",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function renderRestNote(durationBeats: number) {
  const duration = Math.max(1, Math.round(durationBeats * TICKS_PER_BEAT));
  return [
    "      <note>",
    "        <rest/>",
    `        <duration>${duration}</duration>`,
    `        <type>${musicXmlDurationType(durationBeats)}</type>`,
    "      </note>",
  ].join("\n");
}

function assignChordGroups(notes: ScoreNote[]): ScoreNote[] {
  const grouped = new Map<string, ScoreNote[]>();
  for (const note of notes) {
    if (note.isRest) {
      continue;
    }
    const key = `${note.measureNumber}:${roundTo(note.startBeat, 4)}:${note.hand}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(note);
    grouped.set(key, bucket);
  }

  const result: ScoreNote[] = [];
  for (const group of grouped.values()) {
    const chordId = group.length > 1 ? `ch-${group[0].measureNumber}-${group[0].hand}-${roundTo(group[0].startBeat, 3)}` : null;
    for (const note of group) {
      result.push({
        ...note,
        chordId,
      });
    }
  }
  return result.sort(compareNotes);
}

function compareNotes(left: ScoreNote, right: ScoreNote) {
  return (left.startBeat - right.startBeat) || (left.midiValue - right.midiValue) || left.id.localeCompare(right.id);
}

function scientificPitchToMusicXml(pitch: string) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch.trim());
  if (!match) {
    return { step: "C", alter: null, octave: 4 };
  }
  const [, letter, accidental, octaveText] = match;
  let alter: number | null = null;
  if (accidental === "#") {
    alter = 1;
  } else if (accidental === "b") {
    alter = -1;
  }
  return {
    step: letter,
    alter,
    octave: Number(octaveText),
  };
}

function keySignatureToFifths(keySignature: string) {
  const mapping: Record<string, number> = {
    C: 0,
    "G": 1,
    "D": 2,
    "A": 3,
    "E": 4,
    "B": 5,
    "F#": 6,
    "C#": 7,
    "F": -1,
    "Bb": -2,
    "Eb": -3,
    "Ab": -4,
    "Db": -5,
    "Gb": -6,
    "Cb": -7,
  };
  const cleaned = keySignature.replace(/\s+/g, "");
  return mapping[cleaned] ?? 0;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function encodeVarLen(value: number) {
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7f) | 0x80);
  }
  const bytes: number[] = [];
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes.reverse();
}

function asciiBytes(value: string) {
  return Array.from(value, (char) => char.charCodeAt(0) & 0xff);
}

function int32ToBytes(value: number) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function log2Denominator(denominator: number) {
  const mapping: Record<number, number> = { 1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5 };
  return mapping[denominator] ?? 2;
}

function roundTo(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function musicXmlDurationType(durationBeats: number) {
  if (durationBeats >= 4) {
    return "whole";
  }
  if (durationBeats >= 2) {
    return "half";
  }
  if (durationBeats >= 1) {
    return "quarter";
  }
  if (durationBeats >= 0.5) {
    return "eighth";
  }
  if (durationBeats >= 0.25) {
    return "16th";
  }
  return "32nd";
}
