import { useMemo } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import type { EditableScoreResponse, ScoreHand, ScoreMeasure, ScoreNote } from "@aims/shared-types";
import { type AccidentalPreference, type DurationValue, type Tool } from "./scoreEditorUtils";
import {
  beatToX,
  buildBeamGroups,
  buildNotationLayouts,
  buildTieSegments,
  ledgerLineYs,
  restGlyphFor,
  staffLines,
  staffMiddleY,
} from "./notationUtils";

type Props = {
  score: EditableScoreResponse;
  measure: ScoreMeasure;
  selectedNoteId: string | null;
  tool: Tool;
  duration: DurationValue;
  accidentalPreference: AccidentalPreference;
  onSelectNote: (noteId: string, measureNumber: number) => void;
  onLanePointerDown: (measureNumber: number, hand: ScoreHand, event: PointerEvent<SVGRectElement>) => void;
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 220;
const BEAT_LEFT = 112;
const BEAT_RIGHT = 36;
const CONTENT_WIDTH = SVG_WIDTH - BEAT_LEFT - BEAT_RIGHT;
const TOP_STAFF_TOP = 36;
const LH_TOP_Y = 126;
const BARLINE_X = SVG_WIDTH - 30;
const REPETITION_DOT_OFFSET = 14;
const NOTEHEAD_RX = 6.8;
const NOTEHEAD_RY = 5.2;

export function MeasureNotation({
  score,
  measure,
  selectedNoteId,
  tool,
  duration,
  accidentalPreference,
  onSelectNote,
  onLanePointerDown,
}: Props) {
  const layouts = useMemo(() => buildNotationLayouts(score, measure), [score, measure]);
  const beamGroups = useMemo(() => buildBeamGroups(layouts.all), [layouts.all]);
  const tieSegments = useMemo(() => buildTieSegments(score, measure, layouts.all), [score, measure, layouts.all]);
  const beatMarkers = useMemo(() => {
    const subdivisions = Math.max(1, Math.round(measure.beatsPerMeasure * 2));
    return Array.from({ length: subdivisions + 1 }, (_, index) => index * 0.5).filter((beat) => beat <= measure.beatsPerMeasure + 0.001);
  }, [measure.beatsPerMeasure]);
  return (
    <div className={`notation-wrap tool-${tool}`} data-duration={duration} data-accidental={accidentalPreference}>
      <svg
        className="notation-svg"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label={`Piano grand staff for measure ${measure.number}`}
      >
        <defs>
          <filter id="note-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(37, 92, 87, 0.18)" />
          </filter>
        </defs>

        <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} className="notation-backdrop" />

        {beatMarkers.map((beat) => {
          const x = beatToX(beat, measure.beatsPerMeasure);
          return (
            <g key={`beat-${beat}`}>
              <line x1={x} y1={TOP_STAFF_TOP - 16} x2={x} y2={LH_TOP_Y + 4 * 12 + 16} className={`beat-grid ${beat % 1 === 0 ? "downbeat" : ""}`} />
              {beat % 1 === 0 && beat > 0 ? <text x={x} y={24} textAnchor="middle" className="beat-label">{beat}</text> : null}
            </g>
          );
        })}

        {renderStaff("rh")}
        {renderStaff("lh")}
        {renderBrace()}
        {renderRepeatMarkers()}

        <rect
          x={BEAT_LEFT}
          y={TOP_STAFF_TOP - 22}
          width={CONTENT_WIDTH}
          height={48}
          fill="transparent"
          className="staff-hit-area"
          onPointerDown={(event) => onLanePointerDown(measure.number, "rh", event)}
        />
        <rect
          x={BEAT_LEFT}
          y={LH_TOP_Y - 22}
          width={CONTENT_WIDTH}
          height={48}
          fill="transparent"
          className="staff-hit-area"
          onPointerDown={(event) => onLanePointerDown(measure.number, "lh", event)}
        />

        {beamGroups.map((group, groupIndex) => (
          <g key={`beam-${groupIndex}`} className={`beam-group ${group.stemUp ? "stem-up" : "stem-down"}`}>
            {group.events.map((event) => renderStemForEvent(event, group.beamY))}
            {renderBeams(group)}
          </g>
        ))}

        {layouts.all.flatMap((layout, layoutIndex) =>
          layout.isRest
            ? renderRest(layout, layoutIndex)
            : layout.noteLayouts.map((noteLayout, noteIndex) => renderNote(noteLayout, layout, layoutIndex, noteIndex)),
        )}

        {tieSegments.map((segment, index) => (
          <path
            key={`tie-${index}`}
            className={`tie-path ${segment.above ? "above" : "below"}`}
            d={tiePath(segment.from.x, segment.from.y, segment.to.x, segment.to.y, segment.above)}
          />
        ))}
      </svg>
    </div>
  );

  function renderStaff(staff: "rh" | "lh") {
    const lineYs = staffLines(staff);
    const label = staff === "rh" ? "Treble" : "Bass";
    const staffLabelY = staff === "rh" ? 92 : 182;
    return (
      <g className={`staff staff-${staff}`}>
        {lineYs.map((lineY) => (
          <line key={`${staff}-${lineY}`} x1={BEAT_LEFT} x2={BARLINE_X} y1={lineY} y2={lineY} className="staff-line" />
        ))}
        <text x={40} y={staffLabelY} className="staff-label-notation">
          {label}
        </text>
      </g>
    );
  }

  function renderBrace() {
    return (
      <path
        className="staff-brace"
        d={`M 76 ${TOP_STAFF_TOP - 4}
           C 62 ${TOP_STAFF_TOP - 4}, 62 ${TOP_STAFF_TOP + 18}, 54 ${TOP_STAFF_TOP + 28}
           C 62 ${TOP_STAFF_TOP + 38}, 62 ${TOP_STAFF_TOP + 62}, 76 ${TOP_STAFF_TOP + 62}
           L 76 ${LH_TOP_Y + 2}
           C 62 ${LH_TOP_Y + 2}, 62 ${LH_TOP_Y + 26}, 54 ${LH_TOP_Y + 36}
           C 62 ${LH_TOP_Y + 46}, 62 ${LH_TOP_Y + 70}, 76 ${LH_TOP_Y + 70}`}
      />
    );
  }

  function renderRepeatMarkers() {
    return (
      <>
        <line x1={BARLINE_X} x2={BARLINE_X} y1={TOP_STAFF_TOP - 4} y2={LH_TOP_Y + 4 * 12 + 4} className="barline" />
        {measure.repeatStart ? (
          <>
            <line x1={BEAT_LEFT + 4} x2={BEAT_LEFT + 4} y1={TOP_STAFF_TOP - 4} y2={LH_TOP_Y + 4 * 12 + 4} className="barline repeat" />
            <line x1={BEAT_LEFT + 10} x2={BEAT_LEFT + 10} y1={TOP_STAFF_TOP - 4} y2={LH_TOP_Y + 4 * 12 + 4} className="barline repeat-thin" />
            <circle cx={BEAT_LEFT + 17} cy={TOP_STAFF_TOP + 26} r="2.5" className="repeat-dot" />
            <circle cx={BEAT_LEFT + 17} cy={TOP_STAFF_TOP + 50} r="2.5" className="repeat-dot" />
          </>
        ) : null}
        {measure.repeatEnd ? (
          <>
            <line x1={BARLINE_X - 8} x2={BARLINE_X - 8} y1={TOP_STAFF_TOP - 4} y2={LH_TOP_Y + 4 * 12 + 4} className="barline repeat-thin" />
            <line x1={BARLINE_X - 2} x2={BARLINE_X - 2} y1={TOP_STAFF_TOP - 4} y2={LH_TOP_Y + 4 * 12 + 4} className="barline repeat" />
            <circle cx={BARLINE_X - REPETITION_DOT_OFFSET} cy={TOP_STAFF_TOP + 26} r="2.5" className="repeat-dot" />
            <circle cx={BARLINE_X - REPETITION_DOT_OFFSET} cy={TOP_STAFF_TOP + 50} r="2.5" className="repeat-dot" />
          </>
        ) : null}
      </>
    );
  }

  function renderStemForEvent(event: (typeof layouts.all)[number], beamY: number) {
    if (event.isRest || !event.noteLayouts.length) {
      return null;
    }
    const stemX = event.stemAnchorX;
    const stemTipY = beamY;
    return (
      <line
        key={`stem-${event.hand}-${event.startBeat}`}
        x1={stemX}
        x2={stemX}
        y1={event.stemUp ? event.stemAnchorY : stemTipY}
        y2={event.stemUp ? stemTipY : event.stemAnchorY}
        className={`stem ${event.stemUp ? "up" : "down"}`}
      />
    );
  }

  function renderBeams(group: (typeof beamGroups)[number]) {
    const firstEvent = group.events[0];
    const lastEvent = group.events[group.events.length - 1];
    const beamY = group.beamY;
    const beamHeight = 6;
    const x1 = firstEvent.stemAnchorX;
    const x2 = lastEvent.stemAnchorX;
    const direction = group.stemUp ? -1 : 1;
    const extraLevels = group.levels;

    if (group.events.length > 1) {
      return Array.from({ length: extraLevels }, (_, level) => {
        const y = beamY + direction * level * 6;
        return <rect key={`beam-${level}`} x={Math.min(x1, x2)} y={y - beamHeight / 2} width={Math.max(18, Math.abs(x2 - x1))} height={beamHeight} rx="2.5" className="beam" />;
      });
    }

    const stubLength = 18;
    return Array.from({ length: extraLevels }, (_, level) => {
      const y = beamY + direction * level * 6;
      return (
        <line
          key={`stub-${level}`}
          x1={x1}
          y1={y}
          x2={x1 + (group.stemUp ? stubLength : -stubLength)}
          y2={y + (group.stemUp ? -5 : 5)}
          className="beam stub"
        />
      );
    });
  }

  function renderRest(layout: (typeof layouts.all)[number], index: number) {
    const glyph = restGlyphFor(layout.durationBeats);
    const staff = layout.hand;
    const y = staffMiddleY(staff) + (layout.durationBeats >= 2 ? -4 : 2);
    const note = layout.notes[0];
    return (
      <g
        key={`rest-${layout.hand}-${layout.startBeat}-${index}`}
        className={`rest-group source-${note?.source ?? "ai"}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => note && onSelectNote(note.id, note.measureNumber)}
        tabIndex={0}
        role="button"
        onKeyDown={(event) => handleKeySelect(event, note)}
      >
        <rect x={layout.x - 20} y={y - 22} width={40} height={44} fill="transparent" />
        <text x={layout.x} y={y} textAnchor="middle" dominantBaseline="middle" className="rest-symbol">
          {glyph}
        </text>
      </g>
    );
  }

  function renderNote(
    noteLayout: (typeof layouts.all)[number]["noteLayouts"][number],
    layout: (typeof layouts.all)[number],
    groupIndex: number,
    noteIndex: number,
  ) {
    const selected = noteLayout.note.id === selectedNoteId;
    const sourceClass = noteLayout.note.source === "ai" ? "source-ai" : "source-user";
    const accidentalXBase = noteLayout.x - 17 - noteIndex * 8;
    return (
      <g
        key={noteLayout.note.id}
        className={`note-group ${sourceClass} ${selected ? "selected" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onSelectNote(noteLayout.note.id, noteLayout.note.measureNumber)}
        tabIndex={0}
        role="button"
        onKeyDown={(event) => handleKeySelect(event, noteLayout.note)}
      >
        <title>
          {noteLayout.note.pitch} | m.{noteLayout.note.measureNumber} | {noteLayout.note.hand.toUpperCase()} | {noteLayout.note.durationBeats} beats
        </title>
        <rect x={noteLayout.x - 18} y={noteLayout.y - 18} width={36} height={36} fill="transparent" />
        {ledgerLineYs(noteLayout.staffStep, layout.hand).map((ledgerY, ledgerIndex) => (
          <line
            key={`${noteLayout.note.id}-ledger-${ledgerIndex}`}
            x1={noteLayout.x - 12}
            x2={noteLayout.x + 12}
            y1={ledgerY}
            y2={ledgerY}
            className="ledger-line"
          />
        ))}
        {noteLayout.accidental ? (
          <text
            x={accidentalXBase - Math.min(groupIndex, 3) * 6}
            y={noteLayout.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={`accidental-glyph ${sourceClass}`}
          >
            {noteLayout.accidental}
          </text>
        ) : null}
        <ellipse
          cx={noteLayout.x}
          cy={noteLayout.y}
          rx={NOTEHEAD_RX}
          ry={NOTEHEAD_RY}
          transform={`rotate(-18 ${noteLayout.x} ${noteLayout.y})`}
          className={`notehead ${noteLayout.isOpen ? "open" : "filled"} ${sourceClass} ${selected ? "selected" : ""}`}
          filter={selected ? "url(#note-glow)" : undefined}
        />
        {renderStem(noteLayout, layout)}
      </g>
    );
  }

  function renderStem(noteLayout: (typeof layouts.all)[number]["noteLayouts"][number], layout: (typeof layouts.all)[number]) {
    const duration = noteLayout.note.durationBeats;
    const needsStem = duration < 4;
    if (!needsStem || layout.canBeam) {
      return null;
    }
    const stemX = layout.stemUp ? noteLayout.x + NOTEHEAD_RX : noteLayout.x - NOTEHEAD_RX;
    const stemEndY = layout.stemUp ? noteLayout.y - layout.stemLength : noteLayout.y + layout.stemLength;
    return (
      <>
        <line
          x1={stemX}
          x2={stemX}
          y1={layout.stemUp ? noteLayout.y : stemEndY}
          y2={layout.stemUp ? stemEndY : noteLayout.y}
          className={`stem single ${layout.stemUp ? "up" : "down"}`}
        />
        {duration <= 0.5 ? (
          <line
            x1={stemX}
            y1={stemEndY}
            x2={stemX + (layout.stemUp ? 16 : -16)}
            y2={stemEndY + (layout.stemUp ? -5 : 5)}
            className="beam stub"
          />
        ) : null}
      </>
    );
  }

  function handleKeySelect(event: KeyboardEvent<SVGGElement>, note: ScoreNote | undefined) {
    if (!note) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectNote(note.id, note.measureNumber);
    }
  }
}

function tiePath(x1: number, y1: number, x2: number, y2: number, above: boolean) {
  const curve = above ? -12 : 12;
  return `M ${x1} ${y1} C ${x1 + 18} ${y1 + curve}, ${x2 - 18} ${y2 + curve}, ${x2} ${y2}`;
}
