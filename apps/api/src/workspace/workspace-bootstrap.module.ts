import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WorkspaceBootstrapService } from "./workspace-bootstrap.service.js";

@Module({
  imports: [ConfigModule],
  providers: [WorkspaceBootstrapService],
  exports: [WorkspaceBootstrapService],
})
export class WorkspaceBootstrapModule {}
