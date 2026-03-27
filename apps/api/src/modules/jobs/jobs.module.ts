import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JobsController } from "./jobs.controller.js";
import { JobsService } from "./jobs.service.js";
import { TranscriptionWorkerService } from "./transcription-worker.service.js";
import { TranscriberModule } from "../../transcriber/transcriber.module.js";
import { ResultsModule } from "../results/results.module.js";

@Module({
  imports: [ConfigModule, TranscriberModule, ResultsModule],
  controllers: [JobsController],
  providers: [JobsService, TranscriptionWorkerService],
  exports: [JobsService],
})
export class JobsModule {}
