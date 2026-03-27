import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getAppEnv } from "../../runtime/app-env.js";
import { LocalStorageService } from "../../storage/storage.service.js";
import {
  buildEditableScoreDraft,
  normalizeEditableScore,
  scoreToMidiBytes,
  scoreToMusicXml,
  RawDraftNote,
} from "@aims/music-domain";
import {
  editableScoreResponseSchema,
  editableScoreSaveSchema,
  rawNoteEventSchema,
  EditableScore,
  EditableScoreResponse,
} from "@aims/shared-types";

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
  ) {}

  async getResult(jobId: string) {
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: {
        result: { include: { assets: true } },
        editedScore: true,
      },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }
    const base = getAppEnv().API_BASE_URL;
    const grouped = new Map<string, { mode: string; musicxmlUrl: string; midiUrl: string }>();
    const benchmark = job.result.benchmark as Record<string, number>;
    for (const asset of job.result.assets) {
      const existing = grouped.get(asset.mode) ?? { mode: asset.mode, musicxmlUrl: "", midiUrl: "" };
      if (asset.assetType === "musicxml") {
        existing.musicxmlUrl = `${base}/api/results/${job.id}/musicxml?mode=${encodeURIComponent(asset.mode)}`;
      } else if (asset.assetType === "midi") {
        existing.midiUrl = `${base}/api/results/${job.id}/midi?mode=${encodeURIComponent(asset.mode)}`;
      }
      grouped.set(asset.mode, existing);
    }
    const assets = Array.from(grouped.values()).sort((left, right) => {
      if (left.mode === "study-friendly") {
        return -1;
      }
      if (right.mode === "study-friendly") {
        return 1;
      }
      return left.mode.localeCompare(right.mode);
    });
    return {
      jobId: job.id,
      tempoBpm: job.result.tempoBpm,
      timeSignature: job.result.timeSignature,
      highestNote: job.result.highestNote,
      lowestNote: job.result.lowestNote,
      repeatedSections: job.result.repeatedSections,
      benchmark,
      notesCount: job.result.notesCount,
      warnings: this.buildWarnings(benchmark),
      rawNotesUrl: job.result.rawNotesPath ? `${base}/api/results/${job.id}/raw-notes?mode=${encodeURIComponent(job.mode)}` : null,
      assets,
      editedScore: job.editedScore ? await this.getEditableScore(job.id) : null,
    };
  }

  async getAsset(jobId: string, assetType: "musicxml" | "midi" | "raw-notes", mode?: string) {
    if (assetType === "raw-notes") {
      const asset = await this.prisma.sheetAsset.findFirst({
        where: {
          jobId,
          assetType: "raw-notes-json",
          mode: mode ?? undefined,
        },
      });
      if (!asset) {
        throw new NotFoundException("Asset not found.");
      }
      return asset;
    }

    const asset = await this.prisma.sheetAsset.findFirst({
      where: {
        jobId,
        assetType,
        mode: mode ?? undefined,
      },
    });
    if (!asset) {
      throw new NotFoundException("Asset not found.");
    }
    return asset;
  }

  async getEditableScore(jobId: string) {
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: {
        upload: true,
        result: true,
        editedScore: true,
      },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }

    const base = getAppEnv().API_BASE_URL;
    if (job.editedScore) {
      const storedScore = job.editedScore.scoreJson as EditableScore;
      const response = editableScoreResponseSchema.parse({
        ...storedScore,
        assets: {
          musicxmlUrl: job.editedScore.musicxmlPath ? `${base}/api/results/${job.id}/editor-score/musicxml` : null,
          midiUrl: job.editedScore.midiPath ? `${base}/api/results/${job.id}/editor-score/midi` : null,
        },
      });
      return response;
    }

    const draft = await this.buildDraftScore(job.id);
    return editableScoreResponseSchema.parse({
      ...draft,
      assets: {
        musicxmlUrl: null,
        midiUrl: null,
      },
    });
  }

  async saveEditableScore(jobId: string, body: unknown) {
    const parsed = editableScoreSaveSchema.parse(body);
    if (parsed.jobId !== jobId) {
      throw new BadRequestException("The score payload does not match the requested job.");
    }

    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: {
        result: true,
        editedScore: true,
      },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }

    const now = new Date().toISOString();
    const nextVersion = Math.max(parsed.version, job.editedScore ? (job.editedScore.scoreJson as EditableScore).version : 0) + 1;
    const normalized = normalizeEditableScore({
      ...parsed,
      variant: "user-edited",
      version: nextVersion,
      updatedAt: now,
      createdAt: job.editedScore ? (job.editedScore.scoreJson as EditableScore).createdAt : parsed.createdAt,
    });
    const exportRoot = `edited-scores/${jobId}`;
    const musicxmlPath = `${exportRoot}/score.musicxml`;
    const midiPath = `${exportRoot}/score.mid`;
    await this.storage.saveGeneratedText(musicxmlPath, scoreToMusicXml(normalized));
    await this.storage.saveGeneratedBuffer(midiPath, Buffer.from(scoreToMidiBytes(normalized)));

    const saved = await this.prisma.editedScore.upsert({
      where: { jobId },
      update: {
        scoreJson: normalized as unknown as object,
        musicxmlPath,
        midiPath,
      },
      create: {
        jobId,
        scoreJson: normalized as unknown as object,
        musicxmlPath,
        midiPath,
      },
    });

    return editableScoreResponseSchema.parse({
      ...(saved.scoreJson as EditableScore),
      assets: {
        musicxmlUrl: `${getAppEnv().API_BASE_URL}/api/results/${jobId}/editor-score/musicxml`,
        midiUrl: `${getAppEnv().API_BASE_URL}/api/results/${jobId}/editor-score/midi`,
      },
    });
  }

  async getEditableScoreAsset(jobId: string, assetType: "musicxml" | "midi") {
    const score = await this.prisma.editedScore.findUnique({ where: { jobId } });
    if (!score) {
      throw new NotFoundException("Edited score not found.");
    }
    const path = assetType === "musicxml" ? score.musicxmlPath : score.midiPath;
    if (!path) {
      throw new NotFoundException(`${assetType} asset not found.`);
    }
    return {
      storagePath: path,
      mimeType: assetType === "musicxml" ? "application/vnd.recordare.musicxml+xml" : "audio/midi",
      downloadName: assetType === "musicxml" ? "edited-score.musicxml" : "edited-score.mid",
    };
  }

  async getDraftEditableScore(jobId: string) {
    return this.buildDraftScore(jobId);
  }

  private async buildDraftScore(jobId: string) {
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: {
        upload: true,
        result: true,
      },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }
    if (!job.result.rawNotesPath) {
      throw new BadRequestException("The transcription result does not include raw notes.");
    }

    const rawJson = await this.storage.readGeneratedText(job.result.rawNotesPath);
    const rawNotes = rawNoteEventSchema.array().parse(JSON.parse(rawJson)) as RawDraftNote[];
    return buildEditableScoreDraft({
      jobId: job.id,
      title: `${job.upload.originalName.replace(/\.[^.]+$/, "") || "AIMS"} draft`,
      tempoBpm: job.result.tempoBpm,
      timeSignature: job.result.timeSignature,
      keySignature: this.inferKeySignature(job.result.benchmark as Record<string, number>),
      sourceMode: job.mode as "original" | "study-friendly",
      rawNotes,
      variant: "ai-draft",
    });
  }

  private buildWarnings(benchmark: Record<string, number>) {
    const warnings: string[] = [];
    if ((benchmark.meterConfidence ?? 1) < 0.55) {
      warnings.push("Meter confidence was low, so the notation falls back to a readability-first meter.");
    }
    if ((benchmark.keyConfidence ?? 1) < 0.45) {
      warnings.push("Pitch spelling confidence is limited, so some accidentals may still need manual cleanup.");
    }
    if ((benchmark.studyDensityPerMeasure ?? 0) > 8) {
      warnings.push("The study-friendly notation is still dense and should be treated as a guided draft.");
    }
    if ((benchmark.maxRightHandPolyphony ?? 0) > 3 || (benchmark.maxLeftHandPolyphony ?? 0) > 2) {
      warnings.push("Some chords remain thicker than ideal for beginner piano reading.");
    }
    return warnings;
  }

  private inferKeySignature(benchmark: Record<string, number>) {
    const sharps = Math.round(benchmark.estimatedSharps ?? 0);
    const keys: Record<number, string> = {
      "-7": "Cb",
      "-6": "Gb",
      "-5": "Db",
      "-4": "Ab",
      "-3": "Eb",
      "-2": "Bb",
      "-1": "F",
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
