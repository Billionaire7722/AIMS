import asyncio
import json
import time
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.core.models import (
    JobStatus,
    TranscriberAssetPath,
    TranscriberJobRequest,
    TranscriberResult,
    build_state,
)
from app.core.state_store import JobStateStore
from app.services.analysis import (
    NoteEvent,
    detect_repeated_sections,
    estimate_tempo_and_beats,
    infer_time_signature,
)
from app.services.audio import extract_normalized_wav
from app.services.export import build_piano_score, export_score, score_to_json
from app.services.notation import prepare_notation
from app.services.transcription import parse_midi_to_events, run_aria_amt_transcription


class TranscriptionPipeline:
    def __init__(self, settings: Settings, state_store: JobStateStore):
        self.settings = settings
        self.state_store = state_store
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def create_job(self, payload: dict[str, Any]):
        request = TranscriberJobRequest.model_validate(payload)
        queued = build_state(
            job_id=request.jobId,
            status=JobStatus.queued,
            progress=0,
            stage="queued",
            message="Job accepted and queued.",
        )
        await self.state_store.set(queued)
        self._tasks[request.jobId] = asyncio.create_task(self._run_job(request))
        return queued

    async def _run_job(self, request: TranscriberJobRequest) -> None:
        benchmark: dict[str, float] = {}
        try:
            start_total = time.perf_counter()
            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.processing,
                    progress=5,
                    stage="preprocessing",
                    message="Preparing audio.",
                )
            )
            source_path = Path(request.uploadPath)
            if not source_path.exists():
                raise FileNotFoundError(f"Uploaded media file was not found: {source_path}")
            job_dir = Path(request.outputRoot) / request.jobId
            job_dir.mkdir(parents=True, exist_ok=True)
            wav_path = job_dir / "normalized.wav"

            t0 = time.perf_counter()
            extract_normalized_wav(self.settings.ffmpeg_path, source_path, wav_path)
            benchmark["preprocessSeconds"] = time.perf_counter() - t0

            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.processing,
                    progress=20,
                    stage="beat-tracking",
                    message="Estimating tempo and beat grid.",
                    benchmark=benchmark.copy(),
                )
            )
            t0 = time.perf_counter()
            tempo_bpm, beat_times, beat_confidence = estimate_tempo_and_beats(wav_path)
            benchmark["beatTrackingSeconds"] = time.perf_counter() - t0
            benchmark["beatConfidence"] = beat_confidence

            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.processing,
                    progress=35,
                    stage="transcription",
                    message="Running aria-amt transcription.",
                    benchmark=benchmark.copy(),
                )
            )
            t0 = time.perf_counter()
            aria_output_dir = job_dir / "aria-amt"
            midi_path = run_aria_amt_transcription(
                aria_amt_bin=self.settings.aria_amt_bin,
                checkpoint_path=self.settings.aria_amt_checkpoint_path,
                audio_path=wav_path,
                save_dir=aria_output_dir,
            )
            benchmark["transcriptionSeconds"] = time.perf_counter() - t0

            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.processing,
                    progress=55,
                    stage="symbolic-analysis",
                    message="Parsing MIDI and preparing score exports.",
                    benchmark=benchmark.copy(),
                )
            )
            t0 = time.perf_counter()
            raw_events_dicts = parse_midi_to_events(midi_path)
            raw_events = [
                NoteEvent(
                    pitch=item["pitch"],
                    start_ql=item["start_ql"],
                    duration_ql=item["duration_ql"],
                    velocity=item["velocity"],
                )
                for item in raw_events_dicts
            ]
            if not raw_events:
                raise RuntimeError("aria-amt completed but produced no note events.")
            time_signature, meter_confidence = infer_time_signature(
                beat_times,
                tempo_bpm,
                raw_events,
                beat_confidence=beat_confidence,
            )
            benchmark["meterConfidence"] = meter_confidence
            raw_notes_rel = f"{request.jobId}/raw-notes.json"
            (job_dir / "raw-notes.json").write_text(
                json.dumps(score_to_json(raw_events), indent=2),
                encoding="utf-8",
            )
            prepared_notation = prepare_notation(
                raw_events,
                tempo_bpm=tempo_bpm,
                time_signature=time_signature,
                meter_confidence=meter_confidence,
                beat_confidence=beat_confidence,
            )
            repeated_sections = detect_repeated_sections(prepared_notation.study_note_events, time_signature)
            benchmark.update(prepared_notation.metrics)
            benchmark["symbolicAnalysisSeconds"] = time.perf_counter() - t0

            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.processing,
                    progress=75,
                    stage="exporting",
                    message="Writing MusicXML and MIDI assets.",
                    benchmark=benchmark.copy(),
                )
            )
            t0 = time.perf_counter()
            original_score = build_piano_score(
                right_hand=prepared_notation.debug_timelines["right"],
                left_hand=prepared_notation.debug_timelines["left"],
                tempo_bpm=tempo_bpm,
                time_signature=time_signature,
                key_signature=prepared_notation.key_signature,
                title="AIMS Raw Debug Piano Reduction",
            )
            study_score = build_piano_score(
                right_hand=prepared_notation.study_timelines["right"],
                left_hand=prepared_notation.study_timelines["left"],
                tempo_bpm=tempo_bpm,
                time_signature=time_signature,
                key_signature=prepared_notation.key_signature,
                title="AIMS Study-Friendly Piano Reduction",
            )
            original_musicxml, original_midi = export_score(original_score, job_dir, "original")
            study_musicxml, study_midi = export_score(study_score, job_dir, "study-friendly")
            benchmark["exportSeconds"] = time.perf_counter() - t0
            benchmark["totalSeconds"] = time.perf_counter() - start_total

            highest_note = "C4"
            lowest_note = "C4"
            if raw_events:
                highest_note = self._midi_to_name(max(raw_events, key=lambda event: event.pitch).pitch)
                lowest_note = self._midi_to_name(min(raw_events, key=lambda event: event.pitch).pitch)

            result = TranscriberResult(
                jobId=request.jobId,
                tempoBpm=float(round(tempo_bpm, 2)),
                timeSignature=time_signature,
                highestNote=highest_note,
                lowestNote=lowest_note,
                repeatedSections=repeated_sections,
                benchmark=benchmark.copy(),
                notesCount=len(prepared_notation.study_note_events),
                rawNotesPath=raw_notes_rel,
                assets=[
                    TranscriberAssetPath(
                        mode="original",
                        musicxmlPath=f"{request.jobId}/{original_musicxml}",
                        midiPath=f"{request.jobId}/{original_midi}",
                    ),
                    TranscriberAssetPath(
                        mode="study-friendly",
                        musicxmlPath=f"{request.jobId}/{study_musicxml}",
                        midiPath=f"{request.jobId}/{study_midi}",
                    ),
                ],
            )
            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.completed,
                    progress=100,
                    stage="completed",
                    message="Transcription finished.",
                    result=result,
                    benchmark=benchmark.copy(),
                )
            )
        except Exception as exc:
            await self.state_store.set(
                build_state(
                    job_id=request.jobId,
                    status=JobStatus.failed,
                    progress=100,
                    stage="failed",
                    message="Transcription failed.",
                    error_message=str(exc),
                    benchmark=benchmark.copy(),
                )
            )
        finally:
            self._tasks.pop(request.jobId, None)

    def _midi_to_name(self, midi: int) -> str:
        from music21 import pitch

        return pitch.Pitch(midi).nameWithOctave
