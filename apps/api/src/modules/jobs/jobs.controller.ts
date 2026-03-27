import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { JobsService } from "./jobs.service.js";
import { transcriptionJobResponseSchema } from "@aims/shared-types";

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post("transcribe")
  async create(@Body() body: unknown) {
    const job = await this.jobsService.createTranscriptionJob(body);
    return transcriptionJobResponseSchema.parse({
      id: job.id,
      uploadId: job.uploadId,
      projectId: job.projectId,
      status: job.status,
      progress: job.progress,
      mode: job.mode,
      transcriberJobId: job.transcriberJobId,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return this.jobsService.getJob(id);
  }

  @Get(":id/status")
  async getStatus(@Param("id") id: string) {
    return this.jobsService.getJobStatus(id);
  }
}
