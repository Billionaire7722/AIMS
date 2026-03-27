import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ResultsController } from "./results.controller.js";
import { ResultsService } from "./results.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
