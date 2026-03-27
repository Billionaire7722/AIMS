import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Queue } from "bullmq";
import { Model } from "mongoose";
import { transcriptionJobCreateSchema } from "@aims/shared-types";
import { UploadEntity, type UploadDocument, TranscriptionJobEntity, type TranscriptionJobDocument } from "../../database/mongo.schemas.js";
import { getAppEnv } from "../../runtime/app-env.js";
import { TranscriberClientService } from "../../transcriber/transcriber-client.service.js";

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly queue: Queue<{ jobId: string }>;

  constructor(
    @InjectModel(UploadEntity.name) private readonly uploads: Model<UploadDocument>,
    @InjectModel(TranscriptionJobEntity.name) private readonly jobs: Model<TranscriptionJobDocument>,
    private readonly transcriberClient: TranscriberClientService,
  ) {
    const env = getAppEnv();
    this.queue = new Queue("transcription-jobs", {
      connection: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        maxRetriesPerRequest: null,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async createTranscriptionJob(body: unknown) {
    const parsed = transcriptionJobCreateSchema.parse(body);
    const upload = await this.uploads.findById(parsed.uploadId).lean();
    if (!upload) {
      throw new NotFoundException("Upload not found.");
    }

    const existing = await this.jobs.findOne({ uploadId: upload._id }).lean();
    if (existing) {
      throw new BadRequestException("That upload already has a transcription job.");
    }

    const job = await this.jobs.create({
      userId: upload.userId,
      projectId: upload.projectId,
      uploadId: upload._id,
      mode: parsed.mode,
      status: "queued",
      progress: 0,
    });

    await this.queue.add(
      "transcribe",
      { jobId: job._id },
      {
        jobId: job._id,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return job;
  }

  async getJob(jobId: string) {
    const [job, upload] = await Promise.all([
      this.jobs.findById(jobId).lean(),
      this.jobs.findById(jobId).lean().then((current) => current ? this.uploads.findById(current.uploadId).lean() : null),
    ]);
    if (!job) {
      throw new NotFoundException("Job not found.");
    }

    return {
      id: job._id,
      uploadId: job.uploadId,
      projectId: job.projectId,
      status: job.status,
      progress: job.progress,
      mode: job.mode,
      transcriberJobId: job.transcriberJobId,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: job.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      upload: upload
        ? {
            id: upload._id,
            fileName: upload.originalName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
          }
        : null,
      result: job.result ?? null,
    };
  }

  async getJobStatus(jobId: string) {
    const job = await this.jobs.findById(jobId).lean();
    if (!job) {
      throw new NotFoundException("Job not found.");
    }

    let status = job.status;
    let progress = job.progress;
    let stage: string | null = null;
    let message: string | null = null;
    let errorMessage = job.errorMessage;

    if (job.transcriberJobId && job.status !== "completed" && job.status !== "failed") {
      try {
        const live = await this.transcriberClient.getJobStatus(job.transcriberJobId);
        stage = live.stage;
        message = live.message ?? null;

        if (live.status === "processing") {
          status = "processing";
          progress = Math.max(job.progress, live.progress);
        } else if (live.status === "failed") {
          status = "failed";
          progress = Math.max(job.progress, live.progress);
          errorMessage = live.errorMessage ?? job.errorMessage;
        } else if (live.status === "completed") {
          status = job.status;
          progress = Math.max(job.progress, 90);
          stage = "finalizing";
          message = "Finalizing score documents and exports.";
        }
      } catch {
        // Use the persisted API job state when the transcriber is temporarily unreachable.
      }
    }

    return {
      id: job._id,
      status,
      progress,
      mode: job.mode,
      transcriberJobId: job.transcriberJobId,
      stage,
      message,
      errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
