import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";
import { WorkspaceBootstrapModule } from "../../workspace/workspace-bootstrap.module.js";

@Module({
  imports: [WorkspaceBootstrapModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
