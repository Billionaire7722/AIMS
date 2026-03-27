import { Injectable, OnModuleInit } from "@nestjs/common";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAppEnv } from "../runtime/app-env.js";

@Injectable()
export class LocalStorageService implements OnModuleInit {
  private uploadDir = "";
  private generatedDir = "";

  async onModuleInit() {
    const env = getAppEnv();
    this.uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
    this.generatedDir = path.resolve(process.cwd(), env.GENERATED_ASSETS_DIR);
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.mkdir(this.generatedDir, { recursive: true });
  }

  async saveUploadBuffer(buffer: Buffer, extension: string) {
    const relativePath = `${randomUUID()}${extension}`;
    const absolutePath = this.resolveUploadPath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    return { relativePath, absolutePath, sizeBytes: buffer.length };
  }

  async saveGeneratedText(relativePath: string, contents: string) {
    return this.saveGeneratedBuffer(relativePath, Buffer.from(contents, "utf8"));
  }

  async readGeneratedText(relativePath: string) {
    const buffer = await this.readGeneratedBuffer(relativePath);
    return buffer.toString("utf8");
  }

  async saveGeneratedBuffer(relativePath: string, buffer: Buffer) {
    const absolutePath = this.resolveGeneratedPath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
    return { relativePath, absolutePath, sizeBytes: buffer.length };
  }

  async readGeneratedBuffer(relativePath: string) {
    return fs.readFile(this.resolveGeneratedPath(relativePath));
  }

  async resolveUploadFile(relativePath: string) {
    const absolutePath = this.resolveUploadPath(relativePath);
    await fs.access(absolutePath);
    return absolutePath;
  }

  resolveUploadPath(relativePath: string) {
    return path.join(this.uploadDir, relativePath);
  }

  resolveGeneratedPath(relativePath: string) {
    return path.join(this.generatedDir, relativePath);
  }

  openGeneratedStream(relativePath: string) {
    return createReadStream(this.resolveGeneratedPath(relativePath));
  }
}
