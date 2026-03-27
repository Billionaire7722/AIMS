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
from app.services.audio import AudioPreprocessingConfig, extract_normalized_wav
from app.services.export import build_piano_score, export_score, score_to_json
from app.services.notation import build_simple_piano_profile, prepare_notation
from app.services.transcription import midi_pitch_name, parse_midi_to_events, run_aria_amt_transcription


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

            processing_profile = "simple-piano"
            notation_profile = build_simple_piano_profile(
                study_confidence_cutoff=self.settings.simple_piano_confidence_cutoff,
                study_min_duration_ql=self.settings.simple_piano_min_duration_ql,
                onset_merge_tolerance_ql=self.settings.simple_piano_onset_merge_tolerance_ql,
                overlap_merge_tolerance_ql=self.settings.simple_piano_overlap_merge_tolerance_ql,
            )

            t0 = time.perf_counter()
            preprocessing = extract_normalized_wav(
                self.settings.ffmpeg_path,
                source_path,
                wav_path,
                config=AudioPreprocessingConfig(
                    sample_rate=self.settings.preprocess_sample_rate,
                    trim_top_db=self.settings.preprocess_trim_top_db,
                    trim_padding_ms=self.settings.preprocess_trim_padding_ms,
                    target_peak=self.settings.preprocess_target_peak,
                    max_boost=self.settings.preprocess_max_boost,
                ),
            )
            benchmark["preprocessSeconds"] = time.perf_counter() - t0
            benchmark["trimStartSeconds"] = preprocessing.trim_start_sec
            benchmark["trimmedDurationSeconds"] = preprocessing.output_duration_sec

            (job_dir / "preprocess-debug.json").write_text(
                json.dumps(
                    {
                        "processingProfile": processing_profile,
                        "sourcePath": str(source_path),
                        "preprocessing": preprocessing.to_dict(),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )

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
            tempo_bpm, beat_times_sec, beat_confidence = estimate_tempo_and_beats(wav_path)
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
            parsed_midi = parse_midi_to_events(
                midi_path,
                beat_times_sec=beat_times_sec,
                fallback_tempo_bpm=tempo_bpm,
            )
            raw_events = parsed_midi.note_events
            if not raw_events:
                raise RuntimeError("aria-amt completed but produced no note events.")
            benchmark["midiTempoBpm"] = parsed_midi.midi_tempo_bpm or 0.0

            time_signature, meter_confidence = infer_time_signature(
                beat_times_sec,
                tempo_bpm,
                raw_events,
                beat_confidence=beat_confidence,
            )
            benchmark["meterConfidence"] = meter_confidence

            raw_notes_rel = f"{request.jobId}/raw-notes.json"
            cleaned_notes_rel = f"{request.jobId}/cleaned-note-events.json"
            debug_notes_rel = f"{request.jobId}/debug-note-events.json"
            study_notes_rel = f"{request.jobId}/study-note-events.json"

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
                profile=notation_profile,
            )
            (job_dir / "cleaned-note-events.json").write_text(
                json.dumps(score_to_json(prepared_notation.cleaned_events), indent=2),
                encoding="utf-8",
            )
            (job_dir / "debug-note-events.json").write_text(
                json.dumps(score_to_json(prepared_notation.debug_note_events), indent=2),
                encoding="utf-8",
            )
            (job_dir / "study-note-events.json").write_text(
                json.dumps(score_to_json(prepared_notation.study_note_events), indent=2),
                encoding="utf-8",
            )

            repeated_sections = detect_repeated_sections(prepared_notation.study_note_events, time_signature)
            benchmark.update(prepared_notation.metrics)
            benchmark["symbolicAnalysisSeconds"] = time.perf_counter() - t0

            pipeline_debug = {
                "processingProfile": processing_profile,
                "uploadFileName": request.uploadFileName,
                "audio": preprocessing.to_dict(),
                "tempoBpm": round(float(tempo_bpm), 4),
                "timeSignature": time_signature,
                "beatConfidence": round(float(beat_confidence), 4),
                "meterConfidence": round(float(meter_confidence), 4),
                "beatTimesSecPreview": beat_times_sec[:48],
                "checkpointPath": self.settings.aria_amt_checkpoint_path,
                "midiPath": str(midi_path),
                "midiTempoBpm": parsed_midi.midi_tempo_bpm,
                "profileSettings": prepared_notation.profile_settings,
                "rawEventCount": len(raw_events),
                "cleanedEventCount": len(prepared_notation.cleaned_events),
                "debugEventCount": len(prepared_notation.debug_note_events),
                "studyEventCount": len(prepared_notation.study_note_events),
                "rawEventPreview": score_to_json(raw_events[:80]),
                "cleanedEventPreview": score_to_json(prepared_notation.cleaned_events[:80]),
                "studyMeasures": self._group_events_by_measure(prepared_notation.study_note_events, time_signature),
                "benchmark": benchmark.copy(),
                "warnings": prepared_notation.warnings,
            }
            (job_dir / "pipeline-debug.json").write_text(
                json.dumps(pipeline_debug, indent=2),
                encoding="utf-8",
            )

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
                highest_note = midi_pitch_name(max(raw_events, key=lambda event: event.pitch).pitch)
                lowest_note = midi_pitch_name(min(raw_events, key=lambda event: event.pitch).pitch)

            result = TranscriberResult(
                jobId=request.jobId,
                tempoBpm=float(round(tempo_bpm, 2)),
                timeSignature=time_signature,
                keySignature=prepared_notation.key_signature.tonic.name,
                highestNote=highest_note,
                lowestNote=lowest_note,
                repeatedSections=repeated_sections,
                benchmark=benchmark.copy(),
                notesCount=len(prepared_notation.study_note_events),
                warnings=prepared_notation.warnings,
                rawNotesPath=raw_notes_rel,
                debugNotesPath=debug_notes_rel,
                studyNotesPath=study_notes_rel,
                modelInfo={
                    "engine": "aria-amt",
                    "mode": request.mode.value,
                    "checkpointPath": self.settings.aria_amt_checkpoint_path or None,
                    "processingProfile": processing_profile,
                },
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

    def _group_events_by_measure(self, events: list[NoteEvent], time_signature: str) -> list[dict[str, Any]]:
        measure_length = self._bar_length_quarter_length(time_signature)
        grouped: dict[int, list[dict[str, Any]]] = {}
        for event in events:
            measure_number = int(event.start_ql // measure_length) + 1
            grouped.setdefault(measure_number, []).append(
                {
                    "pitch": event.pitch,
                    "pitchName": midi_pitch_name(event.pitch),
                    "hand": event.hand,
                    "startQl": round(event.start_ql, 4),
                    "durationQl": round(event.duration_ql, 4),
                    "startSec": round(event.start_sec, 6) if event.start_sec is not None else None,
                    "durationSec": round(event.duration_sec, 6) if event.duration_sec is not None else None,
                    "confidence": round(event.confidence or 0.0, 4),
                }
            )
        return [
            {"measureNumber": measure_number, "notes": notes}
            for measure_number, notes in sorted(grouped.items())
        ]

    def _bar_length_quarter_length(self, time_signature: str) -> float:
        numerator, denominator = time_signature.split("/")
        return (int(numerator) * 4.0) / int(denominator)
