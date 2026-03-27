import { Body, Controller, Param, Post } from "@nestjs/common";
import { FeedbackService } from "./feedback.service.js";

@Controller("results")
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post(":jobId/feedback")
  async create(@Param("jobId") jobId: string, @Body() body: unknown) {
    return this.feedbackService.create(jobId, body);
  }
}
