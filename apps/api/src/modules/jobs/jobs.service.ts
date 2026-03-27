import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { Queue } from "bullmq";
import { transcriptionJobCreateSchema } from "@aims/shared-types";
import { getAppEnv } from "../../runtime/app-env.js";
import { TranscriberClientService } from "../../transcriber/transcriber-client.service.js";

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly queue: Queue<{ jobId: string }>;

  constructor(
    private readonly prisma: PrismaService,
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
    const upload = await this.prisma.upload.findUnique({ where: { id: parsed.uploadId } });
    if (!upload) {
      throw new NotFoundException("Upload not found.");
    }
    const existing = await this.prisma.transcriptionJob.findUnique({ where: { uploadId: upload.id } });
    if (existing) {
      throw new BadRequestException("That upload already has a transcription job.");
    }
    const job = await this.prisma.transcriptionJob.create({
      data: {
        userId: upload.userId,
        projectId: upload.projectId,
        uploadId: upload.id,
        mode: parsed.mode,
        status: "queued",
        progress: 0,
      },
    });
    await this.queue.add("transcribe", { jobId: job.id }, {
      jobId: job.id,
      removeOnComplete: true,
      removeOnFail: false,
    });
    return job;
  }

  async getJob(jobId: string) {
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: {
        upload: true,
        result: { include: { assets: true } },
      },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    return job;
  }

  async getJobStatus(jobId: string) {
    const job = await this.getJob(jobId);
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
          message = "Finalizing result assets.";
        }
      } catch {
        // Fall back to the persisted API job state if the transcriber is temporarily unreachable.
      }
    }

    return {
      id: job.id,
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
