import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { analysisFeedbackSchema } from "@aims/shared-types";

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(jobId: string, body: unknown) {
    const parsed = analysisFeedbackSchema.parse(body);
    const job = await this.prisma.transcriptionJob.findUnique({
      where: { id: jobId },
      include: { result: true },
    });
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    return this.prisma.analysisFeedback.create({
      data: {
        jobId,
        resultId: job.result?.id ?? null,
        rating: parsed.rating,
        comment: parsed.comment ?? null,
        issueTags: parsed.issueTags,
      },
    });
  }
}
