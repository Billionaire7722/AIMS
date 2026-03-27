import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { buildEnvConfig, envValidation } from "./config/env.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { WorkspaceBootstrapModule } from "./workspace/workspace-bootstrap.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { UploadsModule } from "./modules/uploads/uploads.module.js";
import { JobsModule } from "./modules/jobs/jobs.module.js";
import { ResultsModule } from "./modules/results/results.module.js";
import { FeedbackModule } from "./modules/feedback/feedback.module.js";
import { TranscriberModule } from "./transcriber/transcriber.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [buildEnvConfig],
      validate: envValidation,
      envFilePath: ["../../.env", "../../.env.local", ".env", ".env.local"],
    }),
    PrismaModule,
    StorageModule,
    WorkspaceBootstrapModule,
    TranscriberModule,
    HealthModule,
    AuthModule,
    UploadsModule,
    JobsModule,
    ResultsModule,
    FeedbackModule,
  ],
})
export class AppModule {}
