import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service.js";
import { LocalStorageService } from "../../storage/storage.service.js";
import { TranscriberClientService } from "../../transcriber/transcriber-client.service.js";
import fs from "node:fs/promises";
import { getAppEnv } from "../../runtime/app-env.js";

@Injectable()
export class TranscriptionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionWorkerService.name);
  private worker?: Worker<{ jobId: string }>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly transcriberClient: TranscriberClientService,
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
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: { upload: true },
    });
    if (!job) {
      throw new Error(`Transcription job ${jobId} not found.`);
    }
    await this.updateJob(job.id, { status: "processing", progress: 10, startedAt: new Date() });
    const startResponse = await this.transcriberClient.startJob({
      jobId: job.id,
      uploadPath: this.storage.resolveUploadPath(job.upload.storagePath),
      uploadFileName: job.upload.originalName,
      outputRoot: this.storage.resolveGeneratedPath(""),
      mode: job.mode,
    });
    await this.updateJob(job.id, {
      transcriberJobId: startResponse.id,
      progress: 15,
      status: "processing",
    });
    while (true) {
      const status = await this.transcriberClient.getJobStatus(startResponse.id);
      await this.updateJob(job.id, {
        status: status.status,
        progress: status.progress,
        errorMessage: status.errorMessage ?? null,
      });
      if (status.status === "completed") {
        if (!status.result) {
          throw new Error("Transcriber completed without a result payload.");
        }
        await this.persistResult(job.id, status.result);
        await this.updateJob(job.id, {
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
  }

  private async persistResult(jobId: string, result: any) {
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: { upload: true },
    });
    if (!job) {
      throw new Error(`Transcription job ${jobId} not found when persisting results.`);
    }
    const created = await this.prisma.transcriptionResult.upsert({
      where: { jobId },
      update: {
        tempoBpm: result.tempoBpm,
        timeSignature: result.timeSignature,
        highestNote: result.highestNote,
        lowestNote: result.lowestNote,
        repeatedSections: result.repeatedSections,
        benchmark: result.benchmark,
        notesCount: result.notesCount,
        rawNotesPath: result.rawNotesPath ?? null,
        selectedMode: job.mode,
      },
      create: {
        jobId,
        projectId: job.projectId,
        tempoBpm: result.tempoBpm,
        timeSignature: result.timeSignature,
        highestNote: result.highestNote,
        lowestNote: result.lowestNote,
        repeatedSections: result.repeatedSections,
        benchmark: result.benchmark,
        notesCount: result.notesCount,
        rawNotesPath: result.rawNotesPath ?? null,
        selectedMode: job.mode,
      },
    });

    await this.prisma.sheetAsset.deleteMany({ where: { resultId: created.id } });

    for (const asset of result.assets as Array<{ mode: string; musicxmlPath: string; midiPath: string; rawNotesPath?: string | null }>) {
      await this.createAssetRow(
        created.id,
        job.id,
        asset.mode,
        "musicxml",
        asset.musicxmlPath,
        "application/vnd.recordare.musicxml+xml",
        this.getDownloadName(asset.mode, "musicxml"),
      );
      await this.createAssetRow(
        created.id,
        job.id,
        asset.mode,
        "midi",
        asset.midiPath,
        "audio/midi",
        this.getDownloadName(asset.mode, "mid"),
      );
    }

    if (result.rawNotesPath) {
      await this.createAssetRow(created.id, job.id, job.mode, "raw-notes-json", result.rawNotesPath, "application/json", `${job.mode}-raw-notes.json`);
    }
  }

  private async createAssetRow(
    resultId: string,
    jobId: string,
    mode: string,
    assetType: string,
    storagePath: string,
    mimeType: string,
    downloadName: string,
  ) {
    const absolutePath = this.storage.resolveGeneratedPath(storagePath);
    const stat = await fs.stat(absolutePath);
    await this.prisma.sheetAsset.create({
      data: {
        resultId,
        jobId,
        mode,
        assetType,
        storagePath,
        mimeType,
        downloadName,
        byteSize: stat.size,
      },
    });
  }

  private async updateJob(jobId: string, patch: Record<string, unknown>) {
    await this.prisma.transcriptionJob.update({
      where: { id: jobId },
      data: patch as any,
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getDownloadName(mode: string, extension: string) {
    if (mode === "original") {
      return `raw-debug.${extension}`;
    }
    return `${mode}.${extension}`;
  }
}
