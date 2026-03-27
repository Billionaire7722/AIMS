import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import bcrypt from "bcryptjs";
import { getAppEnv } from "../runtime/app-env.js";

@Injectable()
export class WorkspaceBootstrapService implements OnModuleInit {
  private defaultUserId = "";
  private defaultProjectId = "";

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const env = getAppEnv();
    const passwordHash = await bcrypt.hash("local-dev-password", 10);
    const user = await this.prisma.user.upsert({
      where: { email: env.LOCAL_DEV_USER_EMAIL },
      update: {},
      create: {
        email: env.LOCAL_DEV_USER_EMAIL,
        passwordHash,
        displayName: "Local Dev",
      },
    });
    const existingProject = await this.prisma.project.findFirst({
      where: {
        ownerId: user.id,
        name: env.LOCAL_DEV_PROJECT_NAME,
      },
    });
    const project = existingProject ?? await this.prisma.project.create({
      data: {
        ownerId: user.id,
        name: env.LOCAL_DEV_PROJECT_NAME,
        description: "Automatically created local development workspace",
      },
    });
    this.defaultUserId = user.id;
    this.defaultProjectId = project.id;
  }

  getDefaultUserId() {
    return this.defaultUserId;
  }

  getDefaultProjectId() {
    return this.defaultProjectId;
  }
}
