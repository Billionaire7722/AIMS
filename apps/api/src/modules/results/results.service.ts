import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  editableScoreSaveSchema,
  type EditableScoreSaveInput,
} from "@aims/shared-types";
import { TranscriptionJobEntity, type TranscriptionJobDocument } from "../../database/mongo.schemas.js";
import { getAppEnv } from "../../runtime/app-env.js";
import { ScoreDocumentsService } from "./score-documents.service.js";

@Injectable()
export class ResultsService {
  constructor(
    @InjectModel(TranscriptionJobEntity.name) private readonly jobs: Model<TranscriptionJobDocument>,
    private readonly scoreDocuments: ScoreDocumentsService,
  ) {}

  async getResult(jobId: string) {
    const job = await this.jobs.findById(jobId).lean();
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    if (!job.result) {
      throw new BadRequestException("The transcription job does not have a completed result yet.");
    }

    const base = getAppEnv().API_BASE_URL;
    const assets = [...(job.result.assets ?? [])]
      .map((asset) => ({
        mode: asset.mode,
        musicxmlUrl: `${base}/api/results/${job._id}/musicxml?mode=${encodeURIComponent(asset.mode)}`,
        midiUrl: `${base}/api/results/${job._id}/midi?mode=${encodeURIComponent(asset.mode)}`,
      }))
      .sort((left, right) => {
        if (left.mode === "study-friendly") return -1;
        if (right.mode === "study-friendly") return 1;
        return left.mode.localeCompare(right.mode);
      });

    return {
      jobId: job._id,
      tempoBpm: job.result.tempoBpm,
      timeSignature: job.result.timeSignature,
      keySignature: job.result.keySignature,
      highestNote: job.result.highestNote,
      lowestNote: job.result.lowestNote,
      repeatedSections: job.result.repeatedSections,
      benchmark: job.result.benchmark ?? {},
      notesCount: job.result.notesCount,
      warnings: job.result.warnings ?? [],
      rawNotesUrl: job.result.rawNotesPath ? `${base}/api/results/${job._id}/raw-notes?mode=${encodeURIComponent(job.mode)}` : null,
      assets,
    };
  }

  async getAsset(jobId: string, assetType: "musicxml" | "midi" | "raw-notes", mode?: string) {
    const job = await this.jobs.findById(jobId).lean();
    if (!job || !job.result) {
      throw new NotFoundException("Result not found.");
    }

    if (assetType === "raw-notes") {
      if (!job.result.rawNotesPath) {
        throw new NotFoundException("Raw notes asset not found.");
      }
      return {
        storagePath: job.result.rawNotesPath,
        mimeType: "application/json",
        downloadName: `${mode ?? "draft"}-raw-notes.json`,
      };
    }

    const asset = (job.result.assets ?? []).find((entry) => entry.mode === (mode ?? entry.mode));
    if (!asset) {
      throw new NotFoundException("Asset not found.");
    }
    return {
      storagePath: assetType === "musicxml" ? asset.musicxmlPath : asset.midiPath,
      mimeType: assetType === "musicxml" ? "application/vnd.recordare.musicxml+xml" : "audio/midi",
      downloadName: `${asset.mode}-draft.${assetType === "musicxml" ? "musicxml" : "mid"}`,
    };
  }

  async getEditableScore(jobId: string) {
    return this.scoreDocuments.getCurrentEditableScore(jobId);
  }

  async getDraftScore(jobId: string, mode: string | undefined) {
    const sourceMode = mode === "original" ? "original" : "study-friendly";
    return this.scoreDocuments.getDraftScore(jobId, sourceMode);
  }

  async saveEditableScore(jobId: string, body: unknown) {
    const parsed = editableScoreSaveSchema.parse(body);
    if (parsed.jobId !== jobId) {
      throw new BadRequestException("The score payload does not match the requested job.");
    }
    return this.scoreDocuments.saveEditedScore(jobId, parsed as EditableScoreSaveInput);
  }

  async getEditableScoreAsset(jobId: string, assetType: "musicxml" | "midi") {
    return this.scoreDocuments.getEditedScoreAsset(jobId, assetType);
  }
}
