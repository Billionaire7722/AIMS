import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ResultsController } from "./results.controller.js";
import { ResultsService } from "./results.service.js";
import { ScoreDocumentsService } from "./score-documents.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [ResultsController],
  providers: [ResultsService, ScoreDocumentsService],
  exports: [ResultsService, ScoreDocumentsService],
})
export class ResultsModule {}
