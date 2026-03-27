import { Injectable } from "@nestjs/common";
import { transcriberJobCreateSchema, transcriberJobStatusSchema } from "@aims/shared-types";
import { getAppEnv } from "../runtime/app-env.js";

@Injectable()
export class TranscriberClientService {
  private get baseUrl() {
    return getAppEnv().TRANSCRIBER_URL;
  }

  async startJob(input: unknown) {
    const parsed = transcriberJobCreateSchema.parse(input);
    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!response.ok) {
      throw new Error(`Failed to start transcriber job: ${response.status} ${await response.text()}`);
    }
    return transcriberJobStatusSchema.pick({
      id: true,
      status: true,
      progress: true,
      stage: true,
      message: true,
      errorMessage: true,
      updatedAt: true,
    }).parse(await response.json());
  }

  async getJobStatus(jobId: string) {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transcriber job status: ${response.status} ${await response.text()}`);
    }
    return transcriberJobStatusSchema.parse(await response.json());
  }
}
