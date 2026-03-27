import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UploadsService } from "./uploads.service.js";
import { uploadResponseSchema } from "@aims/shared-types";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 250 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File, @Body("projectId") projectId?: string) {
    if (!file) {
      throw new BadRequestException("Upload a file under the `file` field.");
    }
    const upload = await this.uploadsService.createUpload(file, projectId);
    return uploadResponseSchema.parse({
      id: upload._id,
      fileName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      storagePath: upload.storagePath,
      createdAt: upload.createdAt.toISOString(),
    });
  }
}
