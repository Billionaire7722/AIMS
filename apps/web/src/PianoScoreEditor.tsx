import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { EditableScoreResponse, ScoreHand, ScoreNote, TranscriptionResultResponse } from "@aims/shared-types";
import { measureLengthBeats, scoreToPlaybackEvents, scientificPitchToMidi } from "@aims/music-domain";
import { saveEditableScore } from "./api";
import {
  DURATION_OPTIONS,
  addMeasureAfter,
  addNote,
  addRest,
  clearAssets,
  cloneScore,
  duplicateMeasure,
  findNote,
  getDurationLabel,
  measureForBeat,
  normalizeScore,
  pitchFromMidi,
  removeNote,
  replaceNoteAccidental,
  replaceNoteDuration,
  replaceNoteHand,
  replaceNotePitch,
  scoreToBeatRange,
  snapBeat,
  splitChord,
  mergeChord,
  toggleRepeatEnd,
  toggleRepeatStart,
  toggleTieStart,
  toggleTieStop,
  toSavePayload,
  type AccidentalPreference,
  type LoopMode,
  type Tool,
  type DurationValue,
} from "./scoreEditorUtils";

type Props = {
  jobId: string;
  result: TranscriptionResultResponse;
  initialScore: EditableScoreResponse;
};

type HistoryState = {
  present: EditableScoreResponse;
  past: EditableScoreResponse[];
  future: EditableScoreResponse[];
};

type HistoryAction =
  | { type: "commit"; next: EditableScoreResponse }
  | { type: "replace"; next: EditableScoreResponse }
  | { type: "reset"; next: EditableScoreResponse }
  | { type: "undo" }
  | { type: "redo" };

type PlaybackState = {
  isPlaying: boolean;
  isPaused: boolean;
  currentBeat: number;
  currentMeasure: number;
  loopMode: LoopMode;
  metronome: boolean;
  soundEnabled: boolean;
};

type MeasureRange = {
  start: number;
  end: number;
};

const HAND_LABELS: Record<ScoreHand, string> = { rh: "RH", lh: "LH" };
const ACCIDENTAL_LABELS: Record<AccidentalPreference, string> = {
  natural: "Natural",
  sharp: "Sharp",
  flat: "Flat",
};

function clearScoreAssets(score: EditableScoreResponse): EditableScoreResponse {
  return clearAssets(score);
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit":
      return { present: normalizeScore(clearScoreAssets(action.next)), past: [...state.past, state.present], future: [] };
    case "replace":
      return { ...state, present: normalizeScore(clearScoreAssets(action.next)) };
    case "reset":
      return { present: normalizeScore(clearScoreAssets(action.next)), past: [], future: [] };
    case "undo":
      if (!state.past.length) return state;
      return { present: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.present, ...state.future] };
    case "redo":
      if (!state.future.length) return state;
      return { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1) };
    default:
      return state;
  }
}

function getTotalBeats(score: EditableScoreResponse) {
  const lastMeasure = score.measures[score.measures.length - 1];
  return (lastMeasure?.startBeat ?? 0) + (lastMeasure?.beatsPerMeasure ?? measureLengthBeats(score.timeSignature));
}

function measureNumberAtBeat(score: EditableScoreResponse, beat: number) {
  return measureForBeat(score, beat)?.number ?? score.measures[score.measures.length - 1]?.number ?? 1;
}

function rangeLabel(range: MeasureRange) {
  return range.start === range.end ? `m.${range.start}` : `m.${range.start} - m.${range.end}`;
}

function roundBeat(value: number) {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

function groupNotes(notes: ScoreNote[]) {
  const grouped = new Map<number, ScoreNote[]>();
  for (const note of notes) {
    const onset = roundBeat(note.startBeat);
    const bucket = grouped.get(onset) ?? [];
    bucket.push(note);
    grouped.set(onset, bucket);
  }
  return Array.from(grouped.entries())
    .map(([startBeat, bucket]) => ({
      startBeat,
      notes: bucket.sort((left, right) => left.midiValue - right.midiValue || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.startBeat - right.startBeat);
}

function notePositionPercent(note: ScoreNote, beatsPerMeasure: number) {
  const beatFraction = beatsPerMeasure > 0 ? note.startBeat / beatsPerMeasure : 0;
  return Math.max(0, Math.min(100, beatFraction * 100));
}

function noteHeightPercent(note: ScoreNote, index: number, count: number) {
  const offset = count > 1 ? (index - (count - 1) / 2) * 10 : 0;
  const base = note.hand === "rh" ? 22 : 68;
  return Math.max(6, Math.min(88, base + offset));
}

function laneMidiFromPointer(hand: ScoreHand, yRatio: number) {
  const clamped = Math.max(0, Math.min(1, yRatio));
  const lowest = hand === "rh" ? 60 : 36;
  const highest = hand === "rh" ? 84 : 60;
  return Math.round(highest - clamped * (highest - lowest));
}

function findClosestNoteAtBeat(score: EditableScoreResponse, measureNumber: number, hand: ScoreHand, beat: number) {
  const measure = score.measures.find((item) => item.number === measureNumber);
  if (!measure) return null;
  const notes = hand === "rh" ? measure.rightHandNotes : measure.leftHandNotes;
  if (!notes.length) return null;
  return [...notes].sort((left, right) => {
    const leftDistance = Math.abs(left.startBeat - beat);
    const rightDistance = Math.abs(right.startBeat - beat);
    return leftDistance - rightDistance || left.midiValue - right.midiValue;
  })[0];
}

function findNoteAtPlacement(
  score: EditableScoreResponse,
  measureNumber: number,
  hand: ScoreHand,
  startBeat: number,
  durationBeats: number,
  midiValue: number,
  isRest: boolean,
) {
  const measure = score.measures.find((item) => item.number === measureNumber);
  if (!measure) return null;
  const bucket = hand === "rh" ? measure.rightHandNotes : measure.leftHandNotes;
  return (
    bucket.find(
      (note) =>
        note.isRest === isRest &&
        Math.abs(note.startBeat - startBeat) <= 0.001 &&
        Math.abs(note.durationBeats - durationBeats) <= 0.001 &&
        (isRest || note.midiValue === midiValue),
    ) ?? null
  );
}

function pitchDraftFor(note: ScoreNote | null) {
  if (!note || note.pitch === "Rest") return "";
  return note.pitch;
}

export function PianoScoreEditor({ jobId, result, initialScore }: Props) {
  const [history, dispatch] = useReducer(historyReducer, {
    present: normalizeScore(clearScoreAssets(initialScore)),
    past: [],
    future: [],
  });
  const score = history.present;
  const scoreRef = useRef(score);
  const playbackRef = useRef<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentBeat: 0,
    currentMeasure: score.measures[0]?.number ?? 1,
    loopMode: "off",
    metronome: false,
    soundEnabled: true,
  });
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const playbackRangeRef = useRef<MeasureRange | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState(score.measures[0]?.number ?? 1);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [insertHand, setInsertHand] = useState<ScoreHand>("rh");
  const [duration, setDuration] = useState<DurationValue>(1);
  const [accidentalPreference, setAccidentalPreference] = useState<AccidentalPreference>("natural");
  const [pitchDraft, setPitchDraft] = useState("");
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentBeat: 0,
    currentMeasure: score.measures[0]?.number ?? 1,
    loopMode: "off",
    metronome: false,
    soundEnabled: true,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    if (!findNote(score, selectedNoteId)) {
      setSelectedNoteId(null);
    }
    if (!score.measures.some((measure) => measure.number === selectedMeasure)) {
      setSelectedMeasure(score.measures[score.measures.length - 1]?.number ?? 1);
    }
  }, [score, selectedMeasure, selectedNoteId]);

  useEffect(() => {
    const selectedNote = findNote(score, selectedNoteId);
    setPitchDraft(pitchDraftFor(selectedNote));
    if (selectedNote) {
      setSelectedMeasure(selectedNote.measureNumber);
    }
  }, [score, selectedNoteId]);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          dispatch(event.shiftKey ? { type: "redo" } : { type: "undo" });
          return;
        }
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          void handleSave();
          return;
        }
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        handleDelete();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        changePitch(1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        changePitch(-1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        changeDuration(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        changeDuration(1);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        setTool("note");
        return;
      }
      if (event.key.toLowerCase() === "r") {
        setTool("rest");
        return;
      }
      if (event.key.toLowerCase() === "d") {
        setTool("delete");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNoteId, pitchDraft, duration, accidentalPreference, selectedMeasure, playback.isPlaying, playback.isPaused, playback.currentBeat]);

  const selectedNote = useMemo(() => findNote(score, selectedNoteId), [score, selectedNoteId]);
  const selectedRange = useMemo(() => {
    if (selectionAnchor === null) return null;
    return {
      start: Math.min(selectionAnchor, selectedMeasure),
      end: Math.max(selectionAnchor, selectedMeasure),
    };
  }, [selectionAnchor, selectedMeasure]);

  const currentMeasure = playback.isPlaying ? playback.currentMeasure : selectedNote?.measureNumber ?? selectedMeasure;
  const totalMeasures = score.measures.length;
  const activeLoopRange =
    playback.loopMode === "measure"
      ? scoreToBeatRange(score, selectedMeasure)
      : playback.loopMode === "range"
        ? scoreToBeatRange(score, selectedRange ? selectedRange.start : selectedMeasure)
        : null;
  const dirty = history.past.length > 0;
  const editedExportReady = Boolean(score.assets.musicxmlUrl || score.assets.midiUrl);

  function commit(next: EditableScoreResponse) {
    dispatch({ type: "commit", next });
    setSaveState("idle");
    setSaveMessage(null);
    setSaveError(null);
  }

  function replace(next: EditableScoreResponse) {
    dispatch({ type: "replace", next });
    setSaveState("idle");
    setSaveMessage(null);
    setSaveError(null);
  }

  function reset(next: EditableScoreResponse) {
    dispatch({ type: "reset", next });
  }

  function selectedMeasureScore() {
    return score.measures.find((measure) => measure.number === selectedMeasure) ?? score.measures[0] ?? null;
  }

  function updateScoreMeta(updater: (draft: EditableScoreResponse) => EditableScoreResponse) {
    commit(updater(cloneScore(scoreRef.current)));
  }

  function handleSelectNote(noteId: string, measureNumber: number) {
    setSelectedNoteId(noteId);
    setSelectedMeasure(measureNumber);
    setTool("select");
  }

  function handleDelete() {
    if (!selectedNoteId) {
      const fallback = findClosestNoteAtBeat(scoreRef.current, selectedMeasure, insertHand, activeLoopRange?.start ?? 0);
      if (fallback) {
        commit(removeNote(scoreRef.current, fallback.id));
      }
      return;
    }
    commit(removeNote(scoreRef.current, selectedNoteId));
    setSelectedNoteId(null);
  }

  function changePitch(delta: number) {
    if (!selectedNote) return;
    commit(
      replaceNotePitch(
        scoreRef.current,
        selectedNote.id,
        Math.max(0, Math.min(127, selectedNote.midiValue + delta)),
        accidentalPreference,
      ),
    );
  }

  function changeDuration(direction: number) {
    if (!selectedNote) return;
    const options = DURATION_OPTIONS.map((option) => option.value);
    const index = options.indexOf(selectedNote.durationBeats as DurationValue);
    const next = options[Math.max(0, Math.min(options.length - 1, index + direction))] ?? selectedNote.durationBeats;
    commit(replaceNoteDuration(scoreRef.current, selectedNote.id, next));
  }

  function applyAccidental(next: AccidentalPreference) {
    setAccidentalPreference(next);
    if (selectedNote) {
      commit(replaceNoteAccidental(scoreRef.current, selectedNote.id, next));
    }
  }

  function handleMoveHand() {
    if (!selectedNote) return;
    const nextHand = selectedNote.hand === "rh" ? "lh" : "rh";
    commit(replaceNoteHand(scoreRef.current, selectedNote.id, nextHand));
    setInsertHand(nextHand);
  }

  function handleMergeChord() {
    if (!selectedNote) return;
    commit(mergeChord(scoreRef.current, selectedNote.id));
  }

  function handleSplitChord() {
    if (!selectedNote) return;
    commit(splitChord(scoreRef.current, selectedNote.id));
  }

  function handleAddMeasure() {
    commit(addMeasureAfter(scoreRef.current));
  }

  function handleDuplicateMeasure() {
    commit(duplicateMeasure(scoreRef.current, selectedMeasure));
  }

  function handleRepeatStart() {
    commit(toggleRepeatStart(scoreRef.current, selectedMeasure));
  }

  function handleRepeatEnd() {
    commit(toggleRepeatEnd(scoreRef.current, selectedMeasure));
  }

  function handleMeasureClick(measureNumber: number, shiftKey: boolean) {
    if (shiftKey) {
      setSelectionAnchor((current) => current ?? measureNumber);
    } else {
      setSelectionAnchor(null);
    }
    setSelectedMeasure(measureNumber);
  }

function handleLanePointerDown(measureNumber: number, hand: ScoreHand, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const measure = scoreRef.current.measures.find((item) => item.number === measureNumber);
    if (!measure) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const yRatio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    const beat = snapBeat(xRatio * measure.beatsPerMeasure, 0.25);
    const durationBeats = duration;
    const midiValue = laneMidiFromPointer(hand, yRatio);

    if (tool === "delete") {
      const note = findClosestNoteAtBeat(scoreRef.current, measureNumber, hand, beat);
      if (note) {
        commit(removeNote(scoreRef.current, note.id));
      }
      return;
    }

    if (tool === "rest") {
      const next = addRest(scoreRef.current, measureNumber, hand, beat, durationBeats);
      commit(next);
      const inserted = findNoteAtPlacement(next, measureNumber, hand, beat, durationBeats, 0, true);
      setSelectedNoteId(inserted?.id ?? null);
      setSelectedMeasure(measureNumber);
      return;
    }

    const next = addNote(scoreRef.current, measureNumber, hand, beat, durationBeats, midiValue, accidentalPreference);
    commit(next);
    const inserted = findNoteAtPlacement(next, measureNumber, hand, beat, durationBeats, midiValue, false);
    setSelectedNoteId(inserted?.id ?? null);
    setSelectedMeasure(measureNumber);
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveMessage("Saving edited score...");
    setSaveError(null);
    try {
      const response = await saveEditableScore(jobId, toSavePayload(scoreRef.current));
      reset(response);
      setSaveState("saved");
      setSaveMessage("Edited score saved and exports refreshed.");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Failed to save edited score.");
    }
  }

  function stopPlayback(resetBeat = true) {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.close().catch(() => undefined);
      audioRef.current = null;
    }
    setPlayback((current) => ({
      ...current,
      isPlaying: false,
      isPaused: !resetBeat && current.isPlaying ? true : current.isPaused && !resetBeat,
      currentBeat: resetBeat ? 0 : current.currentBeat,
      currentMeasure: resetBeat ? selectedMeasure : current.currentMeasure,
    }));
  }

  function pausePlayback() {
    if (!playback.isPlaying) return;
    stopPlayback(false);
    setPlayback((current) => ({
      ...current,
      isPlaying: false,
      isPaused: true,
    }));
  }

  async function startPlayback(startBeat?: number, rangeOverride?: MeasureRange) {
    const context = new AudioContext();
    audioRef.current = context;
    if (context.state === "suspended") {
      await context.resume();
    }

    const scoreSnapshot = scoreRef.current;
    const tempoBpm = Math.max(20, scoreSnapshot.tempoBpm);
    const totalBeats = getTotalBeats(scoreSnapshot);
    const range = rangeOverride ?? playbackRangeRef.current ?? { start: 0, end: totalBeats };
    const effectiveStart = Math.max(range.start, startBeat ?? range.start);
    const effectiveEnd = Math.max(effectiveStart + 0.001, range.end);
    playbackRangeRef.current = { start: range.start, end: range.end };

    const secondsPerBeat = 60 / tempoBpm;
    const scheduleTone = (whenSeconds: number, durationSeconds: number, midiValue: number, gainValue: number) => {
      if (!playbackRef.current.soundEnabled) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = 440 * 2 ** ((midiValue - 69) / 12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      const startTime = context.currentTime + whenSeconds;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(durationSeconds, 0.12));
      oscillator.start(startTime);
      oscillator.stop(startTime + durationSeconds + 0.05);
    };

    for (const event of scoreToPlaybackEvents(scoreSnapshot)) {
      if (event.startBeat < effectiveStart || event.startBeat >= effectiveEnd) {
        continue;
      }
      scheduleTone(
        (event.startBeat - effectiveStart) * secondsPerBeat,
        event.durationBeats * secondsPerBeat,
        event.midiValue,
        event.hand === "rh" ? 0.38 : 0.28,
      );
    }

    if (playbackRef.current.metronome) {
      const beatCount = Math.ceil(effectiveEnd - effectiveStart);
      for (let index = 0; index <= beatCount; index += 1) {
        const isDownbeat = Math.abs((effectiveStart + index) % measureLengthBeats(scoreSnapshot.timeSignature)) < 0.001;
        scheduleTone(index * secondsPerBeat, 0.05, isDownbeat ? 96 : 84, 0.1);
      }
    }

    const startedAt = context.currentTime;
    setPlayback((current) => ({
      ...current,
      isPlaying: true,
      isPaused: false,
      currentBeat: effectiveStart,
      currentMeasure: measureNumberAtBeat(scoreSnapshot, effectiveStart),
    }));

    timerRef.current = window.setInterval(() => {
      const liveScore = scoreRef.current;
      const liveTempo = Math.max(20, liveScore.tempoBpm);
      const elapsedSeconds = context.currentTime - startedAt;
      const beat = effectiveStart + (elapsedSeconds * liveTempo) / 60;
      setPlayback((current) => ({
        ...current,
        currentBeat: beat,
        currentMeasure: measureNumberAtBeat(liveScore, beat),
      }));

      if (beat >= effectiveEnd) {
        const loopMode = playbackRef.current.loopMode;
        stopPlayback();
        if (loopMode !== "off") {
          window.setTimeout(() => {
            void startPlayback(range.start, range);
          }, 60);
        }
      }
    }, 60);
  }

  async function togglePlayback() {
    if (playback.isPlaying) {
      pausePlayback();
      return;
    }

    const range =
      playback.loopMode === "measure"
        ? scoreToBeatRange(scoreRef.current, selectedMeasure)
        : playback.loopMode === "range"
          ? selectedRange
            ? {
                start: scoreToBeatRange(scoreRef.current, selectedRange.start).start,
                end: scoreToBeatRange(scoreRef.current, selectedRange.end).end,
              }
            : scoreToBeatRange(scoreRef.current, selectedMeasure)
          : { start: 0, end: getTotalBeats(scoreRef.current) };

    if (playback.isPaused) {
      await startPlayback(playback.currentBeat, range);
      return;
    }

    await startPlayback(range.start, range);
  }

  function handleStop() {
    stopPlayback();
    setPlayback((current) => ({
      ...current,
      isPaused: false,
    }));
  }

  function handleTempoChange(value: number) {
    updateScoreMeta((draft) => ({
      ...draft,
      tempoBpm: Math.max(20, Math.min(240, value)),
    }));
  }

  function handleTimeSignatureChange(value: string) {
    updateScoreMeta((draft) => ({
      ...draft,
      timeSignature: value,
    }));
  }

  function handleKeySignatureChange(value: string) {
    updateScoreMeta((draft) => ({
      ...draft,
      keySignature: value,
    }));
  }

  function handlePitchDraftApply() {
    if (!selectedNote) return;
    const midiValue = scientificPitchToMidi(pitchDraft.trim());
    if (midiValue === null) {
      setSaveError("Enter a valid scientific pitch like C#4.");
      return;
    }
    commit(replaceNotePitch(scoreRef.current, selectedNote.id, midiValue, accidentalPreference));
  }

  function handlePlaybackModeToggle(mode: LoopMode) {
    setPlayback((current) => ({ ...current, loopMode: current.loopMode === mode ? "off" : mode }));
  }

  const aiAssetLinks = result.assets.length ? result.assets : [];

  return (
    <section className="editor-shell panel">
      <header className="editor-header">
        <div className="editor-title-block">
          <p className="eyebrow">Editable score</p>
          <h2>{score.title}</h2>
          <div className="status-row">
            <span className={`status-badge ${score.variant === "ai-draft" ? "draft" : "edited"}`}>
              {score.variant === "ai-draft" ? "AI draft" : score.variant === "user-edited" ? "User edited" : "Final export"}
            </span>
            <span className="status-badge muted">{dirty ? "Unsaved edits" : "Saved"}</span>
            <span className="status-badge muted">
              Measure {currentMeasure}/{totalMeasures}
            </span>
            <span className="status-badge muted">{score.tempoBpm.toFixed(0)} BPM</span>
            <span className="status-badge muted">{score.timeSignature}</span>
            <span className="status-badge muted">{score.keySignature}</span>
          </div>
        </div>
        <div className="editor-summary">
          <div>
            <span>AI result</span>
            <strong>{result.tempoBpm.toFixed(1)} BPM</strong>
          </div>
          <div>
            <span>Range</span>
            <strong>
              {result.lowestNote} - {result.highestNote}
            </strong>
          </div>
          <div>
            <span>Notes</span>
            <strong>{result.notesCount}</strong>
          </div>
        </div>
      </header>

      <div className="editor-grid">
        <aside className="tool-panel">
          <div className="panel-section">
            <h3>Note tools</h3>
            <div className="tool-stack">
              <button type="button" className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}>Select</button>
              <button type="button" className={tool === "note" ? "active" : ""} onClick={() => setTool("note")}>Note insertion</button>
              <button type="button" className={tool === "rest" ? "active" : ""} onClick={() => setTool("rest")}>Rest insertion</button>
              <button type="button" className={tool === "delete" ? "active" : ""} onClick={() => setTool("delete")}>Delete tool</button>
            </div>
          </div>

          <div className="panel-section">
            <h3>Accidentals</h3>
            <div className="chip-grid">
              {(Object.keys(ACCIDENTAL_LABELS) as AccidentalPreference[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={accidentalPreference === option ? "active" : ""}
                  onClick={() => applyAccidental(option)}
                >
                  {ACCIDENTAL_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <h3>Ties and chords</h3>
            <div className="tool-stack">
              <button type="button" disabled={!selectedNote} onClick={() => selectedNote && commit(toggleTieStart(scoreRef.current, selectedNote.id))}>Toggle tie start</button>
              <button type="button" disabled={!selectedNote} onClick={() => selectedNote && commit(toggleTieStop(scoreRef.current, selectedNote.id))}>Toggle tie stop</button>
              <button type="button" disabled={!selectedNote} onClick={handleMergeChord}>Merge chord</button>
              <button type="button" disabled={!selectedNote} onClick={handleSplitChord}>Split chord</button>
              <button type="button" disabled={!selectedNote} onClick={handleMoveHand}>Move to {selectedNote?.hand === "rh" ? "LH" : "RH"}</button>
            </div>
          </div>

          <div className="panel-section">
            <h3>Selected note</h3>
            <div className="selection-card">
              <p className="selection-summary">
                {selectedNote ? `${selectedNote.pitch} | m.${selectedNote.measureNumber} | ${HAND_LABELS[selectedNote.hand]}` : "No note selected."}
              </p>
              {selectedNote ? (
                <>
                  <p className="hint">Source: {selectedNote.source === "ai" ? "AI draft" : "User edit"}</p>
                  <p className="hint">Confidence: {selectedNote.confidence ?? 1}</p>
                  <div className="inline-field">
                    <label>
                      Pitch
                      <input value={pitchDraft} onChange={(event) => setPitchDraft(event.target.value)} onBlur={handlePitchDraftApply} placeholder="C#4" />
                    </label>
                    <button type="button" onClick={handlePitchDraftApply}>Apply</button>
                  </div>
                  <div className="inline-field">
                    <label>
                      Duration
                      <select
                        value={selectedNote.durationBeats}
                        onChange={(event) => commit(replaceNoteDuration(scoreRef.current, selectedNote.id, Number(event.target.value)))}
                      >
                        {DURATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => changeDuration(1)}>Longer</button>
                    <button type="button" onClick={() => changeDuration(-1)}>Shorter</button>
                  </div>
                  <div className="tool-stack">
                    <button type="button" onClick={() => changePitch(1)}>Pitch up</button>
                    <button type="button" onClick={() => changePitch(-1)}>Pitch down</button>
                    <button type="button" onClick={handleDelete}>Delete selected</button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="editor-stage">
          <div className="top-toolbar">
            <label>
              Time signature
              <input value={score.timeSignature} onChange={(event) => handleTimeSignatureChange(event.target.value)} placeholder="4/4" />
            </label>
            <label>
              Key signature
              <input value={score.keySignature} onChange={(event) => handleKeySignatureChange(event.target.value)} placeholder="C" />
            </label>
            <label>
              Tempo
              <input type="number" min="20" max="240" value={Math.round(score.tempoBpm)} onChange={(event) => handleTempoChange(Number(event.target.value))} />
            </label>
            <div className="toolbar-actions">
              <button type="button" onClick={handleAddMeasure}>Add measure</button>
              <button type="button" onClick={handleDuplicateMeasure}>Duplicate measure</button>
              <button type="button" onClick={handleRepeatStart}>{selectedMeasureScore()?.repeatStart ? "Clear repeat start" : "Set repeat start"}</button>
              <button type="button" onClick={handleRepeatEnd}>{selectedMeasureScore()?.repeatEnd ? "Clear repeat end" : "Set repeat end"}</button>
            </div>
          </div>

          <div className="measure-tools">
            <button type="button" onClick={() => setSelectedMeasure(Math.max(1, selectedMeasure - 1))} disabled={selectedMeasure <= 1}>Previous measure</button>
            <button type="button" onClick={() => setSelectedMeasure(Math.min(totalMeasures, selectedMeasure + 1))} disabled={selectedMeasure >= totalMeasures}>Next measure</button>
            <button type="button" onClick={() => setInsertHand((value) => (value === "rh" ? "lh" : "rh"))}>Insert {insertHand === "rh" ? "LH" : "RH"}</button>
            <button type="button" className={playback.loopMode === "measure" ? "active" : ""} onClick={() => setPlayback((value) => ({ ...value, loopMode: value.loopMode === "measure" ? "off" : "measure" }))}>Loop current measure</button>
            <button type="button" className={playback.loopMode === "range" ? "active" : ""} onClick={() => handlePlaybackModeToggle("range")}>Loop selection</button>
          </div>

          <div className="score-status-row">
            <div>
              <strong>{selectedRange ? rangeLabel(selectedRange) : `m.${selectedMeasure}`}</strong>
              <p className="hint">
                {selectionAnchor === null ? "Shift-click measure headers to create a loop range." : "Selection anchor set for looping."}
              </p>
            </div>
            <div className="score-status">
              <span>{saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : dirty ? "Unsaved edits" : "Ready"}</span>
              {saveMessage ? <p className="hint">{saveMessage}</p> : null}
              {saveError ? <p className="error">{saveError}</p> : null}
            </div>
          </div>

          <div className="score-strip">
            {score.measures.map((measure) => {
              const isSelected = measure.number === selectedMeasure;
              const isActive = measure.number === currentMeasure;
              const isInRange = selectedRange ? measure.number >= selectedRange.start && measure.number <= selectedRange.end : false;
              return (
                <article
                  key={measure.number}
                  className={`measure-card ${isSelected ? "selected" : ""} ${isActive ? "playing" : ""} ${isInRange ? "range" : ""}`}
                >
                  <button type="button" className="measure-header" onClick={(event) => handleMeasureClick(measure.number, event.shiftKey)}>
                    <span>Measure {measure.number}</span>
                    <span className="measure-meta">
                      {measure.barline !== "single" ? measure.barline : measure.repeatStart ? "repeat start" : measure.repeatEnd ? "repeat end" : "single"}
                    </span>
                  </button>

                  <div className="grand-staff">
                    <div role="button" tabIndex={0} className="staff-lane rh" onPointerDown={(event) => handleLanePointerDown(measure.number, "rh", event)}>
                      <span className="staff-label">RH</span>
                      {groupNotes(measure.rightHandNotes).map((group) => {
                        const clusterSelected = group.notes.some((note) => note.id === selectedNoteId);
                        return (
                          <div
                            key={`rh-${measure.number}-${group.startBeat}`}
                            className={`note-cluster ${clusterSelected ? "selected" : ""}`}
                            style={{ left: `${notePositionPercent(group.notes[0], measure.beatsPerMeasure)}%` } as CSSProperties}
                          >
                            {group.notes.map((note, index) => (
                              <button
                                key={note.id}
                                type="button"
                                className={`note-chip ${note.source} ${note.isRest ? "rest" : ""} ${note.id === selectedNoteId ? "selected" : ""}`}
                                style={{ top: `${noteHeightPercent(note, index, group.notes.length)}%` } as CSSProperties}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => handleSelectNote(note.id, note.measureNumber)}
                                title={`${note.pitch} | ${note.durationBeats} beats | ${note.source === "ai" ? "AI" : "User"}`}
                              >
                                <span>
                                  {note.isRest
                                    ? "Rest"
                                    : pitchFromMidi(
                                        note.midiValue,
                                        note.accidental === "sharp" || note.accidental === "flat" ? note.accidental : "natural",
                                      )}
                                </span>
                                <small>{getDurationLabel(note.durationBeats)}</small>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>

                    <div role="button" tabIndex={0} className="staff-lane lh" onPointerDown={(event) => handleLanePointerDown(measure.number, "lh", event)}>
                      <span className="staff-label">LH</span>
                      {groupNotes(measure.leftHandNotes).map((group) => {
                        const clusterSelected = group.notes.some((note) => note.id === selectedNoteId);
                        return (
                          <div
                            key={`lh-${measure.number}-${group.startBeat}`}
                            className={`note-cluster ${clusterSelected ? "selected" : ""}`}
                            style={{ left: `${notePositionPercent(group.notes[0], measure.beatsPerMeasure)}%` } as CSSProperties}
                          >
                            {group.notes.map((note, index) => (
                              <button
                                key={note.id}
                                type="button"
                                className={`note-chip ${note.source} ${note.isRest ? "rest" : ""} ${note.id === selectedNoteId ? "selected" : ""}`}
                                style={{ top: `${noteHeightPercent(note, index, group.notes.length)}%` } as CSSProperties}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => handleSelectNote(note.id, note.measureNumber)}
                                title={`${note.pitch} | ${note.durationBeats} beats | ${note.source === "ai" ? "AI" : "User"}`}
                              >
                                <span>
                                  {note.isRest
                                    ? "Rest"
                                    : pitchFromMidi(
                                        note.midiValue,
                                        note.accidental === "sharp" || note.accidental === "flat" ? note.accidental : "natural",
                                      )}
                                </span>
                                <small>{getDurationLabel(note.durationBeats)}</small>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="transport-bar">
        <div className="transport-group">
          <button type="button" onClick={() => void togglePlayback()}>{playback.isPlaying ? "Pause" : playback.isPaused ? "Resume" : "Play"}</button>
          <button type="button" onClick={pausePlayback} disabled={!playback.isPlaying}>Pause</button>
          <button type="button" onClick={handleStop}>Stop</button>
        </div>

        <div className="transport-group transport-inline">
          <label>
            Tempo
            <input type="number" min="20" max="240" value={Math.round(score.tempoBpm)} onChange={(event) => handleTempoChange(Number(event.target.value))} />
          </label>
          <button type="button" className={playback.metronome ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, metronome: !current.metronome }))}>Metronome</button>
          <button type="button" className={playback.soundEnabled ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}>Piano sound</button>
        </div>

        <div className="transport-group">
          <button type="button" onClick={handleSave} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving..." : "Save edited score"}</button>
          <div className="transport-readout">
            <span>Beat {playback.currentBeat.toFixed(2)} | Measure {playback.currentMeasure}</span>
            <span>{playback.isPlaying ? "Playing" : playback.isPaused ? "Paused" : "Stopped"}</span>
          </div>
        </div>
      </footer>

      <section className="editor-footnotes">
        <div className="export-card">
          <h3>Edited export</h3>
          <p className="hint">Save regenerates MusicXML and MIDI from the internal editable score model.</p>
          <div className="downloads">
            {editedExportReady ? (
              <>
                <a href={score.assets.musicxmlUrl ?? undefined} target="_blank" rel="noreferrer">Download edited MusicXML</a>
                <a href={score.assets.midiUrl ?? undefined} target="_blank" rel="noreferrer">Download edited MIDI</a>
              </>
            ) : (
              <span className="hint">No edited export yet. Save the score to generate files.</span>
            )}
          </div>
        </div>

        <div className="export-card">
          <h3>AI draft assets</h3>
          <p className="hint">The draft transcription remains available separately from the edited version.</p>
          <div className="downloads">
            {aiAssetLinks.map((asset) => (
              <span key={asset.mode} className="draft-link-set">
                <a href={asset.musicxmlUrl} target="_blank" rel="noreferrer">{asset.mode === "study-friendly" ? "Study-friendly" : "Raw"} MusicXML</a>
                <a href={asset.midiUrl} target="_blank" rel="noreferrer">{asset.mode === "study-friendly" ? "Study-friendly" : "Raw"} MIDI</a>
              </span>
            ))}
          </div>
        </div>

        <div className="shortcut-card">
          <h3>Shortcuts</h3>
          <ul>
            <li>Cmd/Ctrl+S save</li>
            <li>Cmd/Ctrl+Z undo</li>
            <li>Cmd/Ctrl+Shift+Z redo</li>
            <li>Arrow keys change pitch or duration</li>
            <li>N note, R rest, D delete</li>
            <li>Space play or pause</li>
          </ul>
        </div>
      </section>
    </section>
  );
}
