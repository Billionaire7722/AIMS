import type { EditableScoreResponse, ScoreHand, ScoreMeasure, ScoreNote } from "@aims/shared-types";
import { midiToScientificPitch } from "@aims/music-domain";

type ParsedPitch = {
  letter: string;
  octave: number;
};

type StaffKind = "rh" | "lh";

export type NoteGroupLayout = {
  startBeat: number;
  durationBeats: number;
  hand: ScoreHand;
  notes: ScoreNote[];
  isRest: boolean;
  x: number;
  centerY: number;
  stemUp: boolean;
  stemAnchorX: number;
  stemAnchorY: number;
  noteLayouts: Array<{
    note: ScoreNote;
    x: number;
    y: number;
    staffStep: number;
    accidental: string | null;
    ledgerLineSteps: number[];
    isOpen: boolean;
  }>;
  canBeam: boolean;
  stemLength: number;
};

type BeamGroup = {
  events: NoteGroupLayout[];
  levels: number;
  stemUp: boolean;
  beamY: number;
};

const SVG_WIDTH = 1000;
const BEAT_LEFT = 112;
const BEAT_RIGHT = 36;
const CONTENT_WIDTH = SVG_WIDTH - BEAT_LEFT - BEAT_RIGHT;
const TOP_STAFF_TOP = 36;
const STAFF_GAP = 12;
const LH_TOP_Y = 126;
const STAFF_CENTER_OFFSET = 2 * STAFF_GAP;
const NOTEHEAD_RX = 6.8;
const NOTEHEAD_RY = 5.2;
const STEM_LENGTH = 34;

const LETTER_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

const STAFF_BASE: Record<StaffKind, ParsedPitch> = {
  rh: { letter: "E", octave: 4 },
  lh: { letter: "G", octave: 2 },
};

const ACCIDENTAL_GLYPHS: Record<string, string> = {
  natural: String.fromCodePoint(0x266e),
  sharp: String.fromCodePoint(0x266f),
  flat: String.fromCodePoint(0x266d),
  "double-sharp": String.fromCodePoint(0x1d12a),
  "double-flat": String.fromCodePoint(0x1d12b),
};

const REST_GLYPHS: Record<string, string> = {
  whole: String.fromCodePoint(0x1d13b),
  half: String.fromCodePoint(0x1d13c),
  quarter: String.fromCodePoint(0x1d13d),
  eighth: String.fromCodePoint(0x1d13e),
  "16th": String.fromCodePoint(0x1d13f),
};

export function beatToX(startBeat: number, beatsPerMeasure: number) {
  const fraction = beatsPerMeasure > 0 ? startBeat / beatsPerMeasure : 0;
  return BEAT_LEFT + Math.max(0, Math.min(1, fraction)) * CONTENT_WIDTH;
}

export function staffLines(staff: StaffKind) {
  const topY = staff === "rh" ? TOP_STAFF_TOP : LH_TOP_Y;
  return [0, 1, 2, 3, 4].map((line) => topY + line * STAFF_GAP);
}

export function staffMiddleY(staff: StaffKind) {
  return staff === "rh" ? TOP_STAFF_TOP + STAFF_CENTER_OFFSET : LH_TOP_Y + STAFF_CENTER_OFFSET;
}

export function groupNotesByOnset(notes: ScoreNote[]) {
  const grouped = new Map<number, ScoreNote[]>();
  for (const note of notes) {
    const key = roundBeat(note.startBeat);
    const bucket = grouped.get(key) ?? [];
    bucket.push(note);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([startBeat, group]) => ({
      startBeat,
      notes: group.sort((left, right) => left.midiValue - right.midiValue || left.id.localeCompare(right.id)),
      durationBeats: Math.max(...group.map((item) => item.durationBeats)),
      isRest: group.every((item) => item.isRest),
    }))
    .sort((left, right) => left.startBeat - right.startBeat);
}

export function buildNotationLayouts(score: EditableScoreResponse, measure: ScoreMeasure) {
  const rh = layoutHand(measure, "rh");
  const lh = layoutHand(measure, "lh");
  return { rh, lh, all: [...rh, ...lh].sort((left, right) => left.startBeat - right.startBeat) };
}

export function buildTieSegments(score: EditableScoreResponse, measure: ScoreMeasure, layouts: NoteGroupLayout[]) {
  const segments: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    above: boolean;
  }> = [];

  for (const layout of layouts) {
    for (const noteLayout of layout.noteLayouts) {
      if (!noteLayout.note.tieFlags?.start) {
        continue;
      }

      const target = findTieTarget(score, measure.number, noteLayout.note);
      if (!target) {
        continue;
      }

      const sourceStemUp = layout.stemUp;
      const above = !sourceStemUp;
      const yOffset = sourceStemUp ? 18 : -18;
      const from = {
        x: noteLayout.x + (sourceStemUp ? NOTEHEAD_RX : -NOTEHEAD_RX),
        y: noteLayout.y + yOffset,
      };
      const targetMeasure = score.measures.find((item) => item.number === target.measureNumber);
      const targetPitch = target.pitch === "Rest" ? midiToScientificPitch(target.midiValue) : target.pitch;
      const targetStep = staffStepForPitch(targetPitch, target.hand);
      const targetY = yForStaffStep(targetStep, target.hand);
      const targetX = beatToX(target.startBeat, targetMeasure?.beatsPerMeasure ?? measure.beatsPerMeasure);
      const to = {
        x: targetX + (target.hand === "rh" ? NOTEHEAD_RX : -NOTEHEAD_RX),
        y: targetY + yOffset,
      };
      segments.push({ from, to, above });
    }
  }

  return segments;
}

function layoutHand(measure: ScoreMeasure, hand: ScoreHand): NoteGroupLayout[] {
  const staff = hand;
  const rawNotes = hand === "rh" ? measure.rightHandNotes : measure.leftHandNotes;
  const noteGroups = groupNotesByOnset(rawNotes);

  return noteGroups.map((group) => {
    const baseX = beatToX(group.startBeat, measure.beatsPerMeasure);
    const notes = group.notes;
    const spread = chordSpread(notes.length);

    const noteLayouts = group.isRest
      ? []
      : notes.map((note, index) => {
          const pitch = note.pitch === "Rest" ? midiToScientificPitch(note.midiValue) : note.pitch;
          const staffStep = staffStepForPitch(pitch, staff);
          const y = yForStaffStep(staffStep, staff);
          return {
            note,
            x: baseX + spread[index],
            y,
            staffStep,
            accidental: accidentalGlyphFor(note),
            ledgerLineSteps: ledgerLineSteps(staffStep),
            isOpen: note.durationBeats >= 2,
          };
        });

    const averageY = noteLayouts.length
      ? noteLayouts.reduce((sum, layout) => sum + layout.y, 0) / noteLayouts.length
      : staffMiddleY(staff);
    const stemUp = averageY > staffMiddleY(staff);
    const noteEdgeXs = noteLayouts.map((layout) => layout.x + (stemUp ? NOTEHEAD_RX : -NOTEHEAD_RX));
    const stemAnchorX = noteLayouts.length ? (stemUp ? Math.max(...noteEdgeXs) : Math.min(...noteEdgeXs)) : baseX;
    const stemAnchorY = noteLayouts.length ? (stemUp ? Math.min(...noteLayouts.map((layout) => layout.y)) : Math.max(...noteLayouts.map((layout) => layout.y))) : staffMiddleY(staff);
    const durationBeats = group.durationBeats;
    const canBeam = !group.isRest && durationBeats <= 0.5;
    const stemLength = Math.max(28, Math.min(42, STEM_LENGTH + (notes.length > 1 ? 3 : 0)));

    return {
      startBeat: group.startBeat,
      durationBeats,
      hand,
      notes,
      isRest: group.isRest,
      x: baseX,
      centerY: averageY,
      stemUp,
      stemAnchorX,
      stemAnchorY,
      noteLayouts,
      canBeam,
      stemLength,
    };
  });
}

export function buildBeamGroups(layouts: NoteGroupLayout[]) {
  const groups: BeamGroup[] = [];
  let current: NoteGroupLayout[] = [];

  const flush = () => {
    if (current.length) {
      groups.push({
        events: [...current],
        stemUp: current[0].stemUp,
        levels: current[0].durationBeats <= 0.25 ? 2 : 1,
        beamY: current[0].stemUp
          ? Math.min(...current.map((item) => item.noteLayouts.length ? Math.min(...item.noteLayouts.map((layout) => layout.y)) : item.centerY)) - 26
          : Math.max(...current.map((item) => item.noteLayouts.length ? Math.max(...item.noteLayouts.map((layout) => layout.y)) : item.centerY)) + 26,
      });
      current = [];
    }
  };

  for (const layout of layouts) {
    if (!layout.canBeam) {
      flush();
      continue;
    }

    if (!current.length) {
      current.push(layout);
      continue;
    }

    const previous = current[current.length - 1];
    const contiguous = Math.abs(layout.startBeat - (previous.startBeat + previous.durationBeats)) <= 0.001;
    const sameDuration = Math.abs(layout.durationBeats - previous.durationBeats) <= 0.001;
    const sameHand = layout.hand === previous.hand;
    if (contiguous && sameDuration && sameHand) {
      current.push(layout);
    } else {
      flush();
      current.push(layout);
    }
  }

  flush();
  return groups;
}

export function accidentalGlyphFor(note: ScoreNote) {
  if (!note.accidental || note.accidental === "natural") {
    return null;
  }
  return ACCIDENTAL_GLYPHS[note.accidental] ?? null;
}

export function restGlyphFor(durationBeats: number) {
  if (durationBeats >= 4) return REST_GLYPHS.whole;
  if (durationBeats >= 2) return REST_GLYPHS.half;
  if (durationBeats >= 1) return REST_GLYPHS.quarter;
  if (durationBeats >= 0.5) return REST_GLYPHS.eighth;
  return REST_GLYPHS["16th"];
}

export function yForStaffStep(step: number, staff: StaffKind) {
  const topY = staff === "rh" ? TOP_STAFF_TOP : LH_TOP_Y;
  const bottomLineY = topY + 4 * STAFF_GAP;
  return bottomLineY - step * (STAFF_GAP / 2);
}

export function ledgerLineYs(step: number, staff: StaffKind) {
  if (step % 2 !== 0) {
    return [];
  }
  const result: number[] = [];
  if (step < 0) {
    for (let current = -2; current >= step; current -= 2) {
      result.push(yForStaffStep(current, staff));
    }
  } else if (step > 8) {
    for (let current = 10; current <= step; current += 2) {
      result.push(yForStaffStep(current, staff));
    }
  }
  return result;
}

function staffStepForPitch(pitch: string, staff: StaffKind) {
  const parsed = parseScientificPitch(pitch) ?? parseScientificPitch(midiToScientificPitch(staff === "rh" ? 64 : 43)) ?? { letter: "E", octave: 4 };
  const base = STAFF_BASE[staff];
  return diatonicNumber(parsed.letter, parsed.octave) - diatonicNumber(base.letter, base.octave);
}

function chordSpread(count: number) {
  if (count <= 1) {
    return [0];
  }
  const spread = Math.min(8, 4 + count * 0.75);
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spread);
}

function parseScientificPitch(pitch: string): ParsedPitch | null {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch.trim());
  if (!match) {
    return null;
  }
  const [, letter, , octaveText] = match;
  return {
    letter,
    octave: Number(octaveText),
  };
}

function diatonicNumber(letter: string, octave: number) {
  return octave * 7 + LETTER_INDEX[letter];
}

function roundBeat(value: number) {
  return Math.round(value * 1000) / 1000;
}

function ledgerLineSteps(step: number) {
  if (step % 2 !== 0) {
    return [];
  }
  const steps: number[] = [];
  if (step < 0) {
    for (let current = -2; current >= step; current -= 2) {
      steps.push(current);
    }
  } else if (step > 8) {
    for (let current = 10; current <= step; current += 2) {
      steps.push(current);
    }
  }
  return steps;
}

function findTieTarget(score: EditableScoreResponse, measureNumber: number, note: ScoreNote) {
  const flatNotes = score.measures
    .flatMap((measure) =>
      [...measure.rightHandNotes, ...measure.leftHandNotes].map((item) => ({
        note: item,
        absoluteBeat: measure.startBeat + item.startBeat,
      })),
    )
    .sort((left, right) => left.absoluteBeat - right.absoluteBeat || left.note.midiValue - right.note.midiValue);
  const currentMeasure = score.measures.find((item) => item.number === measureNumber);
  const currentAbsoluteBeat = (currentMeasure?.startBeat ?? 0) + note.startBeat;
  return (
    flatNotes.find(
      (candidate) =>
        candidate.absoluteBeat > currentAbsoluteBeat + 0.0001 &&
        candidate.note.hand === note.hand &&
        candidate.note.midiValue === note.midiValue &&
        candidate.note.tieFlags?.stop,
    )?.note ?? null
  );
}
