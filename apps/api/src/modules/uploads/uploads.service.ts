import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { LocalStorageService } from "../../storage/storage.service.js";
import { WorkspaceBootstrapService } from "../../workspace/workspace-bootstrap.service.js";
import path from "node:path";

const allowedMimeTypes = new Set(["audio/mpeg", "video/mp4", "audio/mp4"]);
const extensionByMimeType: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "audio/mp4": ".mp4",
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly workspace: WorkspaceBootstrapService,
  ) {}

  async createUpload(file: Express.Multer.File, projectId?: string) {
    if (!file) {
      throw new BadRequestException("A file is required.");
    }
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException("Only MP3 and MP4 uploads are supported.");
    }
    const extension = extensionByMimeType[file.mimetype] ?? (path.extname(file.originalname).toLowerCase() || ".bin");
    const normalizedProjectId = projectId?.trim();
    const resolvedProjectId = normalizedProjectId || this.workspace.getDefaultProjectId();
    const project = await this.prisma.project.findUnique({ where: { id: resolvedProjectId } });
    if (!project) {
      throw new NotFoundException("Project not found. Leave Project ID blank to use the local default project.");
    }
    const saved = await this.storage.saveUploadBuffer(file.buffer, extension, file.mimetype);
    const upload = await this.prisma.upload.create({
      data: {
        userId: this.workspace.getDefaultUserId(),
        projectId: resolvedProjectId,
        originalName: file.originalname,
        storedName: path.basename(saved.relativePath),
        storagePath: saved.relativePath,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
    return upload;
  }
}
