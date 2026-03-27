import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { analysisFeedbackSchema } from "@aims/shared-types";
import { Model } from "mongoose";
import { TranscriptionJobEntity, type TranscriptionJobDocument } from "../../database/mongo.schemas.js";

@Injectable()
export class FeedbackService {
  constructor(@InjectModel(TranscriptionJobEntity.name) private readonly jobs: Model<TranscriptionJobDocument>) {}

  async create(jobId: string, body: unknown) {
    const parsed = analysisFeedbackSchema.parse(body);
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    job.feedback.push({
      rating: parsed.rating,
      comment: parsed.comment ?? null,
      issueTags: parsed.issueTags,
      createdAt: new Date(),
    } as any);
    await job.save();
    return job.feedback[job.feedback.length - 1];
  }
}
