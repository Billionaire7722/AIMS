import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  buildEditableScoreDraft,
  normalizeEditableScore,
  scoreToMidiBytes,
  scoreToMusicXml,
  scoreToPlaybackEvents,
  summarizePitchRange,
  type RawDraftNote,
} from "@aims/music-domain";
import {
  editableScoreResponseSchema,
  rawNoteEventSchema,
  type EditableScore,
  type EditableScoreResponse,
  type EditableScoreSaveInput,
  type OutputMode,
} from "@aims/shared-types";
import { ScoreEntity, type ScoreDocument, TranscriptionJobEntity, type TranscriptionJobDocument, UploadEntity, type UploadDocument } from "../../database/mongo.schemas.js";
import { getAppEnv } from "../../runtime/app-env.js";
import { LocalStorageService } from "../../storage/storage.service.js";

@Injectable()
export class ScoreDocumentsService {
  constructor(
    @InjectModel(ScoreEntity.name) private readonly scores: Model<ScoreDocument>,
    @InjectModel(TranscriptionJobEntity.name) private readonly jobs: Model<TranscriptionJobDocument>,
    @InjectModel(UploadEntity.name) private readonly uploads: Model<UploadDocument>,
    private readonly storage: LocalStorageService,
  ) {}

  async ensureDraftScores(jobId: string) {
    const { job, upload } = await this.loadJobContext(jobId);
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }

    const baseTitle = upload.originalName.replace(/\.[^.]+$/, "") || "AIMS";
    const keySignature = job.result.keySignature || this.inferKeySignature(job.result.benchmark ?? {});
    const draftSpecs: Array<{ sourceMode: OutputMode; notesPath: string | null; title: string }> = [
      {
        sourceMode: "original",
        notesPath: job.result.debugNotesPath ?? job.result.rawNotesPath,
        title: `${baseTitle} raw debug draft`,
      },
      {
        sourceMode: "study-friendly",
        notesPath: job.result.studyNotesPath ?? job.result.rawNotesPath,
        title: `${baseTitle} study draft`,
      },
    ];

    const drafts: ScoreDocument[] = [];
    for (const spec of draftSpecs) {
      if (!spec.notesPath) {
        continue;
      }
      const rawJson = await this.storage.readGeneratedText(spec.notesPath);
      const rawNotes = rawNoteEventSchema.array().parse(JSON.parse(rawJson)) as RawDraftNote[];
      const draft = buildEditableScoreDraft({
        jobId,
        title: spec.title,
        tempoBpm: job.result.tempoBpm,
        timeSignature: job.result.timeSignature,
        keySignature,
        sourceMode: spec.sourceMode,
        rawNotes,
        variant: "ai-draft",
      });
      const summary = this.summarizeScore(draft);
      const saved = await this.scores.findOneAndUpdate(
        {
          jobId,
          sourceMode: spec.sourceMode,
          variant: "ai-draft",
        },
        {
          $set: {
            projectId: job.projectId,
            uploadId: upload._id,
            sourceMode: spec.sourceMode,
            variant: "ai-draft",
            title: draft.title,
            tempoBpm: draft.tempoBpm,
            timeSignature: draft.timeSignature,
            keySignature: draft.keySignature,
            measureCount: draft.measureCount,
            version: 1,
            noteCount: summary.noteCount,
            range: summary.range,
            status: "draft",
            isCurrent: true,
            basedOnScoreId: null,
            measures: draft.measures,
            musicxmlPath: null,
            midiPath: null,
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
        },
      );
      await this.writeScoreDebugTrace(jobId, spec.sourceMode, draft, upload.originalName);
      drafts.push(saved);
    }

    return drafts;
  }

  async getCurrentEditableScore(jobId: string) {
    const edited = await this.scores.findOne({
      jobId,
      variant: "user-edited",
      isCurrent: true,
    }).lean();
    if (edited) {
      return this.mapScoreDocToResponse(edited);
    }

    const draft = await this.getDraftScore(jobId, "study-friendly");
    return draft;
  }

  async getDraftScore(jobId: string, sourceMode: OutputMode) {
    let draft = await this.scores.findOne({
      jobId,
      sourceMode,
      variant: "ai-draft",
      isCurrent: true,
    }).lean();

    if (!draft) {
      await this.ensureDraftScores(jobId);
      draft = await this.scores.findOne({
        jobId,
        sourceMode,
        variant: "ai-draft",
        isCurrent: true,
      }).lean();
    }

    if (!draft) {
      throw new NotFoundException("Draft score not found.");
    }

    return this.mapScoreDocToResponse(draft);
  }

  async saveEditedScore(jobId: string, body: EditableScoreSaveInput) {
    const { job, upload } = await this.loadJobContext(jobId);
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }

    await this.ensureDraftScores(jobId);
    const currentEdited = await this.scores.findOne({
      jobId,
      variant: "user-edited",
      isCurrent: true,
    }).lean();
    const currentDraft = await this.scores.findOne({
      jobId,
      sourceMode: "study-friendly",
      variant: "ai-draft",
      isCurrent: true,
    }).lean();

    const now = new Date().toISOString();
    const nextVersion = Math.max(body.version, currentEdited?.version ?? 0) + 1;
    const normalized = normalizeEditableScore({
      ...body,
      sourceMode: "study-friendly",
      variant: "user-edited",
      version: nextVersion,
      createdAt: currentEdited?.createdAt?.toISOString?.() ?? body.createdAt,
      updatedAt: now,
    });

    const exportRoot = `edited-scores/${jobId}/v${nextVersion}`;
    const musicxmlPath = `${exportRoot}/score.musicxml`;
    const midiPath = `${exportRoot}/score.mid`;
    await this.storage.saveGeneratedText(musicxmlPath, scoreToMusicXml(normalized));
    await this.storage.saveGeneratedBuffer(midiPath, Buffer.from(scoreToMidiBytes(normalized)));
    await this.writeScoreDebugTrace(jobId, "study-friendly", normalized, upload.originalName, "edited-score-debug.json");

    await this.scores.updateMany(
      {
        jobId,
        variant: "user-edited",
        isCurrent: true,
      },
      { $set: { isCurrent: false } },
    );

    const summary = this.summarizeScore(normalized);
    await this.scores.create({
      jobId,
      projectId: job.projectId,
      uploadId: upload._id,
      sourceMode: "study-friendly",
      variant: "user-edited",
      title: normalized.title,
      tempoBpm: normalized.tempoBpm,
      timeSignature: normalized.timeSignature,
      keySignature: normalized.keySignature,
      measureCount: normalized.measureCount,
      version: normalized.version,
      noteCount: summary.noteCount,
      range: summary.range,
      status: "saved",
      isCurrent: true,
      basedOnScoreId: currentEdited?._id ?? currentDraft?._id ?? null,
      measures: normalized.measures,
      musicxmlPath,
      midiPath,
    });

    const saved = await this.scores.findOne({
      jobId,
      variant: "user-edited",
      isCurrent: true,
    }).lean();
    if (!saved) {
      throw new Error("Edited score was not persisted.");
    }

    return this.mapScoreDocToResponse(saved);
  }

  async getEditedScoreAsset(jobId: string, assetType: "musicxml" | "midi") {
    const score = await this.scores.findOne({
      jobId,
      variant: "user-edited",
      isCurrent: true,
    }).lean();
    if (!score) {
      throw new NotFoundException("Edited score not found.");
    }
    const storagePath = assetType === "musicxml" ? score.musicxmlPath : score.midiPath;
    if (!storagePath) {
      throw new NotFoundException(`${assetType} asset not found.`);
    }
    return {
      storagePath,
      mimeType: assetType === "musicxml" ? "application/vnd.recordare.musicxml+xml" : "audio/midi",
      downloadName: assetType === "musicxml" ? "edited-score.musicxml" : "edited-score.mid",
    };
  }

  private async loadJobContext(jobId: string): Promise<{ job: TranscriptionJobDocument; upload: UploadDocument }> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    const upload = await this.uploads.findById(job.uploadId);
    if (!upload) {
      throw new NotFoundException("Upload not found.");
    }
    return { job, upload };
  }

  private summarizeScore(score: Pick<EditableScore, "measures">) {
    const midiValues = score.measures.flatMap((measure) =>
      [...measure.rightHandNotes, ...measure.leftHandNotes]
        .filter((note) => !note.isRest)
        .map((note) => note.midiValue),
    );
    return {
      noteCount: midiValues.length,
      range: midiValues.length
        ? summarizePitchRange(Math.min(...midiValues), Math.max(...midiValues))
        : { lowest: "C4", highest: "C4" },
    };
  }

  private async writeScoreDebugTrace(
    jobId: string,
    sourceMode: OutputMode,
    score: EditableScore,
    uploadFileName: string,
    fileName?: string,
  ) {
    const playbackEvents = scoreToPlaybackEvents(score).map((event) => ({
      id: event.id,
      measureNumber: event.measureNumber,
      hand: event.hand,
      midiValue: event.midiValue,
      startBeat: event.startBeat,
      durationBeats: event.durationBeats,
    }));
    const measures = score.measures.map((measure) => ({
      measureNumber: measure.number,
      timeSignature: measure.timeSignature,
      rightHandNotes: measure.rightHandNotes.map((note) => ({
        id: note.id,
        pitch: note.pitch,
        midiValue: note.midiValue,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        confidence: note.confidence ?? null,
      })),
      leftHandNotes: measure.leftHandNotes.map((note) => ({
        id: note.id,
        pitch: note.pitch,
        midiValue: note.midiValue,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        confidence: note.confidence ?? null,
      })),
    }));

    const contents = JSON.stringify(
      {
        uploadFileName,
        sourceMode,
        scoreTempoBpm: score.tempoBpm,
        scoreTimeSignature: score.timeSignature,
        playbackEvents,
        measures,
      },
      null,
      2,
    );
    await this.storage.saveGeneratedText(
      `${jobId}/${fileName ?? `${sourceMode}-score-debug.json`}`,
      contents,
    );
  }

  private mapScoreDocToResponse(score: any): EditableScoreResponse {
    const base = getAppEnv().API_BASE_URL;
    return editableScoreResponseSchema.parse({
      id: score._id,
      jobId: score.jobId,
      title: score.title,
      sourceMode: score.sourceMode,
      variant: score.variant,
      tempoBpm: score.tempoBpm,
      timeSignature: score.timeSignature,
      keySignature: score.keySignature,
      measureCount: score.measureCount,
      version: score.version,
      createdAt: score.createdAt.toISOString(),
      updatedAt: score.updatedAt.toISOString(),
      measures: score.measures,
      assets: {
        musicxmlUrl: score.musicxmlPath ? `${base}/api/results/${score.jobId}/editor-score/musicxml` : null,
        midiUrl: score.midiPath ? `${base}/api/results/${score.jobId}/editor-score/midi` : null,
      },
    });
  }

  private inferKeySignature(benchmark: Record<string, number>) {
    const sharps = Math.round(benchmark.estimatedSharps ?? 0);
    const keys: Record<number, string> = {
      [-7]: "Cb",
      [-6]: "Gb",
      [-5]: "Db",
      [-4]: "Ab",
      [-3]: "Eb",
      [-2]: "Bb",
      [-1]: "F",
      0: "C",
      1: "G",
      2: "D",
      3: "A",
      4: "E",
      5: "B",
      6: "F#",
      7: "C#",
    };
    return keys[sharps] ?? "C";
  }
}
