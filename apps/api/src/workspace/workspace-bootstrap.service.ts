import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import bcrypt from "bcryptjs";
import { Model } from "mongoose";
import { ProjectEntity, type ProjectDocument, UserEntity, type UserDocument } from "../database/mongo.schemas.js";
import { getAppEnv } from "../runtime/app-env.js";

@Injectable()
export class WorkspaceBootstrapService implements OnModuleInit {
  private defaultUserId = "";
  private defaultProjectId = "";

  constructor(
    @InjectModel(UserEntity.name) private readonly users: Model<UserDocument>,
    @InjectModel(ProjectEntity.name) private readonly projects: Model<ProjectDocument>,
  ) {}

  async onModuleInit() {
    const env = getAppEnv();
    const passwordHash = await bcrypt.hash("local-dev-password", 10);
    let user = await this.users.findOne({ email: env.LOCAL_DEV_USER_EMAIL }).lean();
    if (!user) {
      user = await this.users.create({
        email: env.LOCAL_DEV_USER_EMAIL,
        passwordHash,
        displayName: "Local Dev",
      });
    }

    let project = await this.projects.findOne({
      ownerId: user._id,
      name: env.LOCAL_DEV_PROJECT_NAME,
    }).lean();
    if (!project) {
      project = await this.projects.create({
        ownerId: user._id,
        name: env.LOCAL_DEV_PROJECT_NAME,
        description: "Automatically created local development workspace",
      });
    }

    this.defaultUserId = user._id;
    this.defaultProjectId = project._id;
  }

  getDefaultUserId() {
    return this.defaultUserId;
  }

  getDefaultProjectId() {
    return this.defaultProjectId;
  }
}
