import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Worker } from "bullmq";
import { Model } from "mongoose";
import { TranscriptionJobEntity, type TranscriptionJobDocument, UploadEntity, type UploadDocument } from "../../database/mongo.schemas.js";
import { LocalStorageService } from "../../storage/storage.service.js";
import { TranscriberClientService } from "../../transcriber/transcriber-client.service.js";
import { getAppEnv } from "../../runtime/app-env.js";
import { ScoreDocumentsService } from "../results/score-documents.service.js";

@Injectable()
export class TranscriptionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionWorkerService.name);
  private worker?: Worker<{ jobId: string }>;

  constructor(
    @InjectModel(TranscriptionJobEntity.name) private readonly jobs: Model<TranscriptionJobDocument>,
    @InjectModel(UploadEntity.name) private readonly uploads: Model<UploadDocument>,
    private readonly storage: LocalStorageService,
    private readonly transcriberClient: TranscriberClientService,
    private readonly scoreDocuments: ScoreDocumentsService,
  ) {}

  async onModuleInit() {
    const env = getAppEnv();
    this.worker = new Worker(
      "transcription-jobs",
      async (queueJob) => this.process(queueJob.data.jobId),
      {
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          maxRetriesPerRequest: null,
        },
        concurrency: 1,
      },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Job ${job?.id} failed: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async process(jobId: string) {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new Error(`Transcription job ${jobId} not found.`);
    }

    const upload = await this.uploads.findById(job.uploadId).lean();
    if (!upload) {
      throw new Error(`Upload ${job.uploadId} not found for job ${jobId}.`);
    }

    const uploadPath = await this.storage.resolveUploadFile(upload.storagePath);
    const generatedRoot = this.storage.resolveGeneratedPath("");

    await this.updateJob(jobId, {
      status: "processing",
      progress: 10,
      startedAt: new Date(),
      errorMessage: null,
    });

    try {
      const startResponse = await this.transcriberClient.startJob({
        jobId: job._id,
        uploadPath,
        uploadFileName: upload.originalName,
        outputRoot: generatedRoot,
        mode: job.mode,
      });

      await this.updateJob(jobId, {
        transcriberJobId: startResponse.id,
        progress: 15,
        status: "processing",
      });

      while (true) {
        const status = await this.transcriberClient.getJobStatus(startResponse.id);
        await this.updateJob(jobId, {
          status: status.status,
          progress: status.progress,
          errorMessage: status.errorMessage ?? null,
        });

        if (status.status === "completed") {
          if (!status.result) {
            throw new Error("Transcriber completed without a result payload.");
          }
          await this.persistResult(jobId, status.result);
          await this.updateJob(jobId, {
            status: "completed",
            progress: 100,
            finishedAt: new Date(),
          });
          return status.result;
        }

        if (status.status === "failed") {
          throw new Error(status.errorMessage ?? "Transcriber job failed.");
        }

        await this.delay(2000);
      }
    } catch (error) {
      await this.updateJob(jobId, {
        status: "failed",
        progress: 100,
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      });
      throw error;
    }
  }

  private async persistResult(jobId: string, result: any) {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new Error(`Transcription job ${jobId} not found when persisting results.`);
    }

    const inferredKeySignature = this.inferKeySignature(result.benchmark ?? {});
    job.result = {
      tempoBpm: result.tempoBpm,
      timeSignature: result.timeSignature,
      keySignature: result.keySignature ?? inferredKeySignature,
      highestNote: result.highestNote,
      lowestNote: result.lowestNote,
      repeatedSections: result.repeatedSections,
      benchmark: result.benchmark ?? {},
      notesCount: result.notesCount,
      warnings: result.warnings ?? [],
      rawNotesPath: result.rawNotesPath ?? null,
      debugNotesPath: result.debugNotesPath ?? null,
      studyNotesPath: result.studyNotesPath ?? null,
      assets: (result.assets ?? []).map((asset: any) => ({
        mode: asset.mode,
        musicxmlPath: asset.musicxmlPath,
        midiPath: asset.midiPath,
      })),
    };
    job.modelInfo = result.modelInfo ?? null;
    await job.save();
    await this.scoreDocuments.ensureDraftScores(jobId);
  }

  private async updateJob(jobId: string, patch: Record<string, unknown>) {
    await this.jobs.updateOne({ _id: jobId }, { $set: patch });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
