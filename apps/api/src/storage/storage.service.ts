import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAppEnv } from "../runtime/app-env.js";

@Injectable()
export class LocalStorageService implements OnModuleInit, OnModuleDestroy {
  private uploadDir = "";
  private generatedDir = "";
  private client: MongoClient | null = null;
  private bucket: GridFSBucket | null = null;

  async onModuleInit() {
    const env = getAppEnv();
    this.uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
    this.generatedDir = path.resolve(process.cwd(), env.GENERATED_ASSETS_DIR);
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.mkdir(this.generatedDir, { recursive: true });

    this.client = new MongoClient(env.DATABASE_URL);
    await this.client.connect();
    this.bucket = new GridFSBucket(this.client.db(), { bucketName: "aims-assets" });
  }

  async onModuleDestroy() {
    await this.client?.close();
    this.client = null;
    this.bucket = null;
  }

  async saveUploadBuffer(buffer: Buffer, extension: string, mimeType = "application/octet-stream") {
    const relativePath = `${randomUUID()}${extension}`;
    await this.saveBuffer(relativePath, buffer, { kind: "upload", mimeType });
    return { relativePath, absolutePath: this.resolveUploadCachePath(relativePath), sizeBytes: buffer.length };
  }

  async saveGeneratedText(relativePath: string, contents: string, mimeType = "text/plain; charset=utf-8") {
    return this.saveGeneratedBuffer(relativePath, Buffer.from(contents, "utf8"), mimeType);
  }

  async readGeneratedText(relativePath: string) {
    const buffer = await this.readStoredBuffer(relativePath, "generated");
    return buffer.toString("utf8");
  }

  async saveGeneratedBuffer(relativePath: string, buffer: Buffer, mimeType = "application/octet-stream") {
    await this.saveBuffer(relativePath, buffer, { kind: "generated", mimeType });
    return { relativePath, absolutePath: this.resolveGeneratedCachePath(relativePath), sizeBytes: buffer.length };
  }

  async readGeneratedBuffer(relativePath: string) {
    return this.readStoredBuffer(relativePath, "generated");
  }

  async resolveUploadPath(relativePath: string) {
    const absolutePath = this.resolveUploadCachePath(relativePath);
    if (await this.pathExists(absolutePath)) {
      return absolutePath;
    }

    const buffer = await this.readStoredBuffer(relativePath, "upload");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    return absolutePath;
  }

  resolveGeneratedPath(relativePath: string) {
    return this.resolveGeneratedCachePath(relativePath);
  }

  async openGeneratedStream(relativePath: string) {
    const localPath = this.resolveGeneratedCachePath(relativePath);
    if (await this.pathExists(localPath)) {
      return createReadStream(localPath);
    }

    const file = await this.findStoredFile(relativePath);
    if (file) {
      return this.requireBucket().openDownloadStream(file._id as ObjectId);
    }

    throw new Error(`Stored generated asset not found: ${relativePath}`);
  }

  private resolveUploadCachePath(relativePath: string) {
    return path.join(this.uploadDir, relativePath);
  }

  private resolveGeneratedCachePath(relativePath: string) {
    return path.join(this.generatedDir, relativePath);
  }

  private requireBucket() {
    if (!this.bucket) {
      throw new Error("Mongo storage bucket is not ready.");
    }
    return this.bucket;
  }

  private async pathExists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async saveBuffer(relativePath: string, buffer: Buffer, metadata: Record<string, unknown>) {
    const bucket = this.requireBucket();
    await this.deleteStoredFile(relativePath);
    await new Promise<void>((resolve, reject) => {
      const upload = bucket.openUploadStream(relativePath, { metadata });
      upload.on("finish", () => resolve());
      upload.on("error", reject);
      upload.end(buffer);
    });
  }

  private async readStoredBuffer(relativePath: string, localKind: "upload" | "generated") {
    const file = await this.findStoredFile(relativePath);
    if (file) {
      return this.readGridFsFile(file._id);
    }

    const localPath = localKind === "upload" ? this.resolveUploadCachePath(relativePath) : this.resolveGeneratedCachePath(relativePath);
    if (await this.pathExists(localPath)) {
      return fs.readFile(localPath);
    }

    throw new Error(`Stored file not found: ${relativePath}`);
  }

  private async findStoredFile(relativePath: string) {
    const bucket = this.requireBucket();
    const files = await bucket.find({ filename: relativePath }).toArray();
    return files.at(-1) ?? null;
  }

  private async readGridFsFile(fileId: unknown) {
    const bucket = this.requireBucket();
    const stream = bucket.openDownloadStream(fileId as ObjectId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async deleteStoredFile(relativePath: string) {
    const bucket = this.requireBucket();
    const files = await bucket.find({ filename: relativePath }).toArray();
    await Promise.all(files.map((file) => bucket.delete(file._id).catch(() => undefined)));
  }
}
