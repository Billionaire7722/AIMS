import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { EditableScoreResponse, ScoreHand, ScoreNote, TranscriptionResultResponse } from "@aims/shared-types";
import { measureLengthBeats, scientificPitchToMidi, scoreToPlaybackEvents } from "@aims/music-domain";
import { saveEditableScore } from "./api";
import { MeasureNotation } from "./MeasureNotation";
import { noticeText, type Notice, useLanguage } from "./i18n";
import {
  DURATION_OPTIONS,
  addNote,
  addRest,
  clearAssets,
  cloneScore,
  findNote,
  measureForBeat,
  normalizeScore,
  removeNote,
  replaceNoteAccidental,
  replaceNoteDuration,
  replaceNoteHand,
  replaceNotePitch,
  scoreToBeatRange,
  snapBeat,
  splitChord,
  mergeChord,
  toggleTieStart,
  toggleTieStop,
  toSavePayload,
  type AccidentalPreference,
  type DurationValue,
  type LoopMode,
  type Tool,
} from "./scoreEditorUtils";

type Props = {
  jobId: string;
  fileName: string;
  result: TranscriptionResultResponse;
  initialScore: EditableScoreResponse;
  debugScore: EditableScoreResponse;
};

type ViewMode = "study" | "debug";

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

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit":
      return { present: normalizeScore(clearAssets(action.next)), past: [...state.past, state.present], future: [] };
    case "replace":
      return { ...state, present: normalizeScore(clearAssets(action.next)) };
    case "reset":
      return { present: normalizeScore(clearAssets(action.next)), past: [], future: [] };
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

function laneMidiFromPointer(hand: ScoreHand, yRatio: number) {
  const clamped = Math.max(0, Math.min(1, yRatio));
  const lowest = hand === "rh" ? 60 : 36;
  const highest = hand === "rh" ? 84 : 60;
  return Math.round(highest - clamped * (highest - lowest));
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

function scoreStats(score: EditableScoreResponse) {
  const notes = score.measures.flatMap((measure) => [...measure.rightHandNotes, ...measure.leftHandNotes]).filter((note) => !note.isRest);
  return {
    noteCount: notes.length,
  };
}

export function PianoScoreEditor({ jobId, fileName, result, initialScore, debugScore }: Props) {
  const { t } = useLanguage();
  const [history, dispatch] = useReducer(historyReducer, {
    present: normalizeScore(clearAssets(initialScore)),
    past: [],
    future: [],
  });
  const [viewMode, setViewMode] = useState<ViewMode>("study");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState(initialScore.measures[0]?.number ?? 1);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [duration, setDuration] = useState<DurationValue>(1);
  const [accidentalPreference, setAccidentalPreference] = useState<AccidentalPreference>("natural");
  const [pitchDraft, setPitchDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<Notice | null>(null);
  const [saveError, setSaveError] = useState<Notice | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentBeat: 0,
    currentMeasure: initialScore.measures[0]?.number ?? 1,
    loopMode: "off",
    metronome: false,
    soundEnabled: true,
  });

  const workingScore = history.present;
  const activeScore = viewMode === "study" ? workingScore : debugScore;
  const canEdit = viewMode === "study";
  const workingScoreRef = useRef(workingScore);
  const activeScoreRef = useRef(activeScore);
  const playbackRef = useRef(playback);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const playbackRangeRef = useRef<MeasureRange | null>(null);

  useEffect(() => {
    dispatch({ type: "reset", next: normalizeScore(clearAssets(initialScore)) });
    setSelectedMeasure(initialScore.measures[0]?.number ?? 1);
    setSelectedNoteId(null);
    setSelectionAnchor(null);
    setViewMode("study");
    setPitchDraft("");
    setSaveState("idle");
    setSaveMessage(null);
    setSaveError(null);
  }, [initialScore, jobId]);

  useEffect(() => {
    workingScoreRef.current = workingScore;
  }, [workingScore]);

  useEffect(() => {
    activeScoreRef.current = activeScore;
  }, [activeScore]);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    if (!activeScore.measures.some((measure) => measure.number === selectedMeasure)) {
      setSelectedMeasure(activeScore.measures[0]?.number ?? 1);
    }
    if (!findNote(activeScore, selectedNoteId)) {
      setSelectedNoteId(null);
    }
  }, [activeScore, selectedMeasure, selectedNoteId]);

  useEffect(() => {
    const selectedNote = findNote(activeScore, selectedNoteId);
    setPitchDraft(pitchDraftFor(selectedNote));
    if (selectedNote) {
      setSelectedMeasure(selectedNote.measureNumber);
    }
  }, [activeScore, selectedNoteId]);

  useEffect(() => {
    return () => stopPlayback();
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
          if (canEdit) {
            dispatch(event.shiftKey ? { type: "redo" } : { type: "undo" });
          }
          return;
        }
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (canEdit) {
            void handleSave();
          }
          return;
        }
      }

      if (event.key === " ") {
        event.preventDefault();
        void togglePlayback();
        return;
      }

      if (!canEdit) {
        return;
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
  }, [canEdit]);

  const selectedRange = useMemo(() => {
    if (selectionAnchor === null) return null;
    return {
      start: Math.min(selectionAnchor, selectedMeasure),
      end: Math.max(selectionAnchor, selectedMeasure),
    };
  }, [selectionAnchor, selectedMeasure]);

  const selectedNote = useMemo(() => findNote(activeScore, selectedNoteId), [activeScore, selectedNoteId]);
  const currentMeasure = playback.isPlaying ? playback.currentMeasure : selectedNote?.measureNumber ?? selectedMeasure;
  const totalMeasures = activeScore.measures.length;
  const dirty = history.past.length > 0;
  const topDraftAsset = result.assets.find((asset) => asset.mode === "study-friendly") ?? result.assets[0] ?? null;
  const rawDraftAsset = result.assets.find((asset) => asset.mode === "original") ?? null;
  const activeStats = scoreStats(activeScore);

  function commit(next: EditableScoreResponse) {
    if (!canEdit) {
      return;
    }
    dispatch({ type: "commit", next });
    setSaveState("idle");
    setSaveMessage(null);
    setSaveError(null);
  }

  function setActiveView(nextView: ViewMode) {
    setViewMode(nextView);
    setSelectedNoteId(null);
    setSelectionAnchor(null);
    setTool("select");
  }

  function handleSelectNote(noteId: string, measureNumber: number) {
    if (canEdit && tool === "delete") {
      commit(removeNote(workingScoreRef.current, noteId));
      setSelectedNoteId(null);
      setSelectedMeasure(measureNumber);
      return;
    }
    setSelectedNoteId(noteId);
    setSelectedMeasure(measureNumber);
    if (canEdit) {
      setTool("select");
    }
  }

  function handleDelete() {
    if (!canEdit || !selectedNoteId) {
      return;
    }
    commit(removeNote(workingScoreRef.current, selectedNoteId));
    setSelectedNoteId(null);
  }

  function changePitch(delta: number) {
    if (!canEdit || !selectedNote) return;
    commit(
      replaceNotePitch(
        workingScoreRef.current,
        selectedNote.id,
        Math.max(0, Math.min(127, selectedNote.midiValue + delta)),
        accidentalPreference,
      ),
    );
  }

  function changeDuration(direction: number) {
    if (!canEdit || !selectedNote) return;
    const options = DURATION_OPTIONS;
    const index = options.indexOf(selectedNote.durationBeats as DurationValue);
    const next = options[Math.max(0, Math.min(options.length - 1, index + direction))] ?? selectedNote.durationBeats;
    commit(replaceNoteDuration(workingScoreRef.current, selectedNote.id, next));
  }

  function applyAccidental(next: AccidentalPreference) {
    setAccidentalPreference(next);
    if (canEdit && selectedNote) {
      commit(replaceNoteAccidental(workingScoreRef.current, selectedNote.id, next));
    }
  }

  function handleMoveHand() {
    if (!canEdit || !selectedNote) return;
    const nextHand = selectedNote.hand === "rh" ? "lh" : "rh";
    commit(replaceNoteHand(workingScoreRef.current, selectedNote.id, nextHand));
  }

  function handleLanePointerDown(measureNumber: number, hand: ScoreHand, event: PointerEvent<SVGRectElement>) {
    if (!canEdit) {
      return;
    }
    event.preventDefault();
    const measure = workingScoreRef.current.measures.find((item) => item.number === measureNumber);
    if (!measure) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const yRatio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    const beat = snapBeat(xRatio * measure.beatsPerMeasure, 0.25);
    const midiValue = laneMidiFromPointer(hand, yRatio);

    if (tool === "delete") {
      return;
    }

    if (tool === "rest") {
      const next = addRest(workingScoreRef.current, measureNumber, hand, beat, duration);
      commit(next);
      const inserted = findNoteAtPlacement(next, measureNumber, hand, beat, duration, 0, true);
      setSelectedNoteId(inserted?.id ?? null);
      setSelectedMeasure(measureNumber);
      return;
    }

    const next = addNote(workingScoreRef.current, measureNumber, hand, beat, duration, midiValue, accidentalPreference);
    commit(next);
    const inserted = findNoteAtPlacement(next, measureNumber, hand, beat, duration, midiValue, false);
    setSelectedNoteId(inserted?.id ?? null);
    setSelectedMeasure(measureNumber);
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveMessage({ key: "savingEditedScore" });
    setSaveError(null);
    try {
      const response = await saveEditableScore(jobId, toSavePayload(workingScoreRef.current));
      dispatch({ type: "reset", next: response });
      setSaveState("saved");
      setSaveMessage({ key: "editedScoreSaved" });
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? { raw: error.message } : { key: "failedToSaveEditedScore" });
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
    const scoreSnapshot = activeScoreRef.current;
    const context = new AudioContext();
    audioRef.current = context;
    if (context.state === "suspended") {
      await context.resume();
    }

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
      const liveScore = activeScoreRef.current;
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

    const scoreSnapshot = activeScoreRef.current;
    const range =
      playback.loopMode === "measure"
        ? scoreToBeatRange(scoreSnapshot, selectedMeasure)
        : playback.loopMode === "range"
          ? selectedRange
            ? {
                start: scoreToBeatRange(scoreSnapshot, selectedRange.start).start,
                end: scoreToBeatRange(scoreSnapshot, selectedRange.end).end,
              }
            : scoreToBeatRange(scoreSnapshot, selectedMeasure)
          : { start: 0, end: getTotalBeats(scoreSnapshot) };

    if (playback.isPaused) {
      await startPlayback(playback.currentBeat, range);
      return;
    }

    await startPlayback(range.start, range);
  }

  function handleStop() {
    stopPlayback();
    setPlayback((current) => ({ ...current, isPaused: false }));
  }

  function handleTempoChange(value: number) {
    if (!canEdit) return;
    const next = cloneScore(workingScoreRef.current);
    next.tempoBpm = Math.max(20, Math.min(240, value));
    commit(next);
  }

  function handlePitchDraftApply() {
    if (!canEdit || !selectedNote) return;
    const midiValue = scientificPitchToMidi(pitchDraft.trim());
    if (midiValue === null) {
      setSaveError({ key: "invalidPitch" });
      return;
    }
    commit(replaceNotePitch(workingScoreRef.current, selectedNote.id, midiValue, accidentalPreference));
  }

  const modeBadge = viewMode === "study" ? t.outputModes["study-friendly"] : t.outputModes.original;
  const viewDescription = viewMode === "study" ? t.outputModeDescriptions["study-friendly"] : t.outputModeDescriptions.original;
  const statusBadge = saveState === "saving"
    ? t.editor.saveStatusSaving
    : saveState === "saved"
      ? t.editor.saveStatusSaved
      : dirty
        ? t.editor.saveStatusUnsaved
        : t.editor.saveStatusReady;

  return (
    <section className="editor-workspace">
      <header className="workspace-topbar">
        <div className="workspace-title">
          <div>
            <p className="section-label">{modeBadge}</p>
            <h1>{fileName}</h1>
          </div>
          <div className="topbar-status">
            <span className={`badge ${viewMode === "study" ? "success" : "muted"}`}>{modeBadge}</span>
            <span className={`badge ${dirty ? "warning" : "muted"}`}>{statusBadge}</span>
            <span className="badge muted">{t.measure.progressLabel(currentMeasure, totalMeasures)}</span>
          </div>
        </div>

        <div className="topbar-actions">
          {topDraftAsset ? (
            <>
              <a className="inline-link" href={topDraftAsset.musicxmlUrl} target="_blank" rel="noreferrer">Draft XML</a>
              <a className="inline-link" href={topDraftAsset.midiUrl} target="_blank" rel="noreferrer">Draft MIDI</a>
            </>
          ) : null}
          {workingScore.assets.musicxmlUrl ? <a className="inline-link" href={workingScore.assets.musicxmlUrl} target="_blank" rel="noreferrer">Edited XML</a> : null}
          {workingScore.assets.midiUrl ? <a className="inline-link" href={workingScore.assets.midiUrl} target="_blank" rel="noreferrer">Edited MIDI</a> : null}
          <button type="button" className="primary-action" onClick={() => void handleSave()} disabled={!canEdit || saveState === "saving"}>
            {saveState === "saving" ? t.editor.saveStatusSaving : t.editor.saveEditedScore}
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="workspace-sidebar">
          <section className="panel-section">
            <h2>{t.common.status}</h2>
            <div className="data-list compact">
              <div><span>{t.app.fileLabel}</span><strong>{fileName}</strong></div>
              <div><span>{t.app.transcriptionModeLabel}</span><strong>{t.outputModes["study-friendly"]}</strong></div>
              <div><span>{t.common.tempo}</span><strong>{Math.round(result.tempoBpm)} BPM</strong></div>
              <div><span>{t.common.range}</span><strong>{result.lowestNote} - {result.highestNote}</strong></div>
              <div><span>{t.common.notes}</span><strong>{result.notesCount}</strong></div>
            </div>
          </section>

          <section className="panel-section">
            <h2>{t.app.workspaceHeading}</h2>
            <div className="segmented-control">
              <button type="button" className={viewMode === "study" ? "active" : ""} onClick={() => setActiveView("study")}>{t.outputModes["study-friendly"]}</button>
              <button type="button" className={viewMode === "debug" ? "active" : ""} onClick={() => setActiveView("debug")}>{t.outputModes.original}</button>
            </div>
            <p className="hint">{viewDescription}</p>
          </section>

          <section className="panel-section">
            <h2>{t.editor.noteToolsHeading}</h2>
            <div className="segmented-control stacked">
              <button type="button" className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} disabled={!canEdit}>{t.editor.selectTool}</button>
              <button type="button" className={tool === "note" ? "active" : ""} onClick={() => setTool("note")} disabled={!canEdit}>{t.editor.noteInsertion}</button>
              <button type="button" className={tool === "rest" ? "active" : ""} onClick={() => setTool("rest")} disabled={!canEdit}>{t.editor.restInsertion}</button>
              <button type="button" className={tool === "delete" ? "active" : ""} onClick={() => setTool("delete")} disabled={!canEdit}>{t.editor.deleteTool}</button>
            </div>
          </section>

          <section className="panel-section">
            <h2>{t.editor.durationLabel}</h2>
            <label className="compact-field">
              <span>{t.editor.durationLabel}</span>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as DurationValue)} disabled={!canEdit}>
                {DURATION_OPTIONS.map((value) => <option key={value} value={value}>{t.durations[value]}</option>)}
              </select>
            </label>
            <div className="segmented-control stacked">
              {(Object.keys(t.accidentals) as AccidentalPreference[]).map((option) => (
                <button key={option} type="button" className={accidentalPreference === option ? "active" : ""} onClick={() => applyAccidental(option)} disabled={!canEdit}>
                  {t.accidentals[option]}
                </button>
              ))}
            </div>
          </section>

          {(saveMessage || saveError) ? (
            <section className="panel-section">
              {saveMessage ? <p className="inline-message success">{noticeText(saveMessage, t)}</p> : null}
              {saveError ? <p className="inline-message error">{noticeText(saveError, t)}</p> : null}
            </section>
          ) : null}
        </aside>

        <main className="workspace-main">
          <div className="workspace-banner">
            <div>
              <strong>{modeBadge}</strong>
              <p>{viewDescription}</p>
            </div>
            <div className="measure-nav">
              <button type="button" onClick={() => setSelectedMeasure(Math.max(1, selectedMeasure - 1))} disabled={selectedMeasure <= 1}>{t.editor.previousMeasure}</button>
              <button type="button" className="measure-pill" onClick={() => setSelectionAnchor(null)}>
                {t.measure.rangeLabel(selectedRange?.start ?? selectedMeasure, selectedRange?.end ?? selectedMeasure)}
              </button>
              <button type="button" onClick={() => setSelectedMeasure(Math.min(totalMeasures, selectedMeasure + 1))} disabled={selectedMeasure >= totalMeasures}>{t.editor.nextMeasure}</button>
            </div>
          </div>

          {result.warnings.length > 0 ? <div className="warning-strip">{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}

          <div className="score-strip">
            {activeScore.measures.map((measure) => {
              const isSelected = measure.number === selectedMeasure;
              const isActive = measure.number === currentMeasure;
              const isInRange = selectedRange ? measure.number >= selectedRange.start && measure.number <= selectedRange.end : false;
              return (
                <article key={`${viewMode}-${measure.number}`} className={`measure-card ${isSelected ? "selected" : ""} ${isActive ? "playing" : ""} ${isInRange ? "range" : ""}`}>
                  <button type="button" className="measure-header" onClick={(event) => {
                    if (event.shiftKey) {
                      setSelectionAnchor((current) => current ?? measure.number);
                    } else {
                      setSelectionAnchor(null);
                    }
                    setSelectedMeasure(measure.number);
                  }}>
                    <span>{t.measure.label} {measure.number}</span>
                    <span className="measure-meta">{measure.timeSignature}</span>
                  </button>
                  <MeasureNotation
                    score={activeScore}
                    measure={measure}
                    selectedNoteId={selectedNoteId}
                    tool={tool}
                    duration={duration}
                    accidentalPreference={accidentalPreference}
                    onSelectNote={handleSelectNote}
                    onLanePointerDown={handleLanePointerDown}
                  />
                </article>
              );
            })}
          </div>
        </main>

        <aside className="workspace-inspector">
          <section className="panel-section">
            <h2>{t.common.status}</h2>
            <div className="data-list compact">
              <div><span>{t.common.tempo}</span><strong>{Math.round(activeScore.tempoBpm)} BPM</strong></div>
              <div><span>{t.common.notes}</span><strong>{activeStats.noteCount}</strong></div>
              <div><span>{t.common.range}</span><strong>{result.lowestNote} - {result.highestNote}</strong></div>
              <div><span>{t.editor.keySignatureLabel}</span><strong>{result.keySignature}</strong></div>
            </div>
          </section>

          <section className="panel-section">
            <h2>{t.editor.selectedNoteHeading}</h2>
            {!selectedNote ? (
              <p className="hint">{t.editor.noNoteSelected}</p>
            ) : (
              <>
                <div className="data-list compact">
                  <div><span>{t.editor.pitchLabel}</span><strong>{selectedNote.pitch}</strong></div>
                  <div><span>{t.editor.durationLabel}</span><strong>{t.durations[selectedNote.durationBeats as DurationValue] ?? selectedNote.durationBeats}</strong></div>
                  <div><span>{t.hands[selectedNote.hand]}</span><strong>{t.measure.label} {selectedNote.measureNumber}</strong></div>
                  <div><span>{t.editor.sourceLabel}</span><strong>{t.sources[selectedNote.source]}</strong></div>
                </div>

                {canEdit ? (
                  <>
                    <label className="compact-field">
                      <span>{t.editor.pitchLabel}</span>
                      <input value={pitchDraft} onChange={(event) => setPitchDraft(event.target.value)} onBlur={handlePitchDraftApply} placeholder="C#4" />
                    </label>
                    <label className="compact-field">
                      <span>{t.editor.durationLabel}</span>
                      <select value={selectedNote.durationBeats} onChange={(event) => commit(replaceNoteDuration(workingScoreRef.current, selectedNote.id, Number(event.target.value)))}>
                        {DURATION_OPTIONS.map((value) => <option key={value} value={value}>{t.durations[value]}</option>)}
                      </select>
                    </label>
                    <div className="segmented-control stacked">
                      <button type="button" onClick={() => changePitch(1)}>{t.editor.pitchUp}</button>
                      <button type="button" onClick={() => changePitch(-1)}>{t.editor.pitchDown}</button>
                      <button type="button" onClick={() => changeDuration(1)}>{t.editor.longerButton}</button>
                      <button type="button" onClick={() => changeDuration(-1)}>{t.editor.shorterButton}</button>
                      <button type="button" onClick={handleMoveHand}>{t.editor.moveToHand(selectedNote.hand)}</button>
                      <button type="button" onClick={() => commit(toggleTieStart(workingScoreRef.current, selectedNote.id))}>{t.editor.toggleTieStart}</button>
                      <button type="button" onClick={() => commit(toggleTieStop(workingScoreRef.current, selectedNote.id))}>{t.editor.toggleTieStop}</button>
                      <button type="button" onClick={() => commit(mergeChord(workingScoreRef.current, selectedNote.id))}>{t.editor.mergeChord}</button>
                      <button type="button" onClick={() => commit(splitChord(workingScoreRef.current, selectedNote.id))}>{t.editor.splitChord}</button>
                      <button type="button" onClick={handleDelete}>{t.editor.deleteSelected}</button>
                    </div>
                  </>
                ) : (
                  <p className="hint">{t.outputModeDescriptions.original}</p>
                )}
              </>
            )}
          </section>

          {rawDraftAsset ? (
            <section className="panel-section">
              <h2>{t.editor.aiDraftAssetsHeading}</h2>
              <div className="inline-actions">
                <a className="inline-link" href={rawDraftAsset.musicxmlUrl} target="_blank" rel="noreferrer">Raw XML</a>
                <a className="inline-link" href={rawDraftAsset.midiUrl} target="_blank" rel="noreferrer">Raw MIDI</a>
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <footer className="transport-bar">
        <div className="transport-cluster">
          <button type="button" onClick={() => void togglePlayback()}>{playback.isPlaying ? t.editor.transportPause : playback.isPaused ? t.editor.transportResume : t.editor.transportPlay}</button>
          <button type="button" onClick={pausePlayback} disabled={!playback.isPlaying}>{t.editor.transportPause}</button>
          <button type="button" onClick={handleStop}>{t.editor.transportStop}</button>
        </div>

        <div className="transport-cluster">
          <button type="button" className={playback.loopMode === "measure" ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, loopMode: current.loopMode === "measure" ? "off" : "measure" }))}>{t.editor.loopCurrentMeasure}</button>
          <button type="button" className={playback.loopMode === "range" ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, loopMode: current.loopMode === "range" ? "off" : "range" }))}>{t.editor.loopSelection}</button>
          <button type="button" className={playback.metronome ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, metronome: !current.metronome }))}>{t.editor.transportMetronome}</button>
        </div>

        <div className="transport-cluster">
          <label className="transport-field">
            <span>{t.editor.transportTempoLabel}</span>
            <input type="number" min="20" max="240" value={Math.round(activeScore.tempoBpm)} onChange={(event) => handleTempoChange(Number(event.target.value))} disabled={!canEdit} />
          </label>
          <button type="button" className={playback.soundEnabled ? "active" : ""} onClick={() => setPlayback((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}>{t.editor.transportPianoSound}</button>
          <div className="transport-readout">
            <strong>{t.editor.transportReadout(playback.currentBeat, playback.currentMeasure)}</strong>
            <span>{playback.isPlaying ? t.editor.transportPlaying : playback.isPaused ? t.editor.transportPaused : t.editor.transportStopped}</span>
          </div>
        </div>
      </footer>
    </section>
  );
}
