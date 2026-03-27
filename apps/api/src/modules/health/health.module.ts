import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller.js";
import { DependencyChecksService } from "../../runtime/dependency-checks.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [DependencyChecksService],
  exports: [DependencyChecksService],
})
export class HealthModule {}
