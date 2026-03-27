import { Body, Controller, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import { ResultsService } from "./results.service.js";
import { Response } from "express";
import { LocalStorageService } from "../../storage/storage.service.js";

@Controller("results")
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly storage: LocalStorageService,
  ) {}

  @Get(":jobId")
  async getResult(@Param("jobId") jobId: string) {
    return this.resultsService.getResult(jobId);
  }

  @Get(":jobId/musicxml")
  async getMusicXml(@Param("jobId") jobId: string, @Query("mode") mode: string | undefined, @Res() res: Response) {
    const asset = await this.resultsService.getAsset(jobId, "musicxml", mode);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${asset.downloadName}"`);
    const stream = await this.storage.openGeneratedStream(asset.storagePath);
    return stream.pipe(res);
  }

  @Get(":jobId/midi")
  async getMidi(@Param("jobId") jobId: string, @Query("mode") mode: string | undefined, @Res() res: Response) {
    const asset = await this.resultsService.getAsset(jobId, "midi", mode);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${asset.downloadName}"`);
    const stream = await this.storage.openGeneratedStream(asset.storagePath);
    return stream.pipe(res);
  }

  @Get(":jobId/raw-notes")
  async getRawNotes(@Param("jobId") jobId: string, @Query("mode") mode: string | undefined, @Res() res: Response) {
    const asset = await this.resultsService.getAsset(jobId, "raw-notes", mode);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${asset.downloadName}"`);
    const stream = await this.storage.openGeneratedStream(asset.storagePath);
    return stream.pipe(res);
  }

  @Get(":jobId/editor-score")
  async getEditableScore(@Param("jobId") jobId: string) {
    return this.resultsService.getEditableScore(jobId);
  }

  @Get(":jobId/draft-score")
  async getDraftScore(@Param("jobId") jobId: string, @Query("mode") mode: string | undefined) {
    return this.resultsService.getDraftScore(jobId, mode);
  }

  @Put(":jobId/editor-score")
  async saveEditableScore(@Param("jobId") jobId: string, @Body() body: unknown) {
    return this.resultsService.saveEditableScore(jobId, body);
  }

  @Get(":jobId/editor-score/musicxml")
  async getEditedMusicXml(@Param("jobId") jobId: string, @Res() res: Response) {
    const asset = await this.resultsService.getEditableScoreAsset(jobId, "musicxml");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${asset.downloadName}"`);
    const stream = await this.storage.openGeneratedStream(asset.storagePath);
    return stream.pipe(res);
  }

  @Get(":jobId/editor-score/midi")
  async getEditedMidi(@Param("jobId") jobId: string, @Res() res: Response) {
    const asset = await this.resultsService.getEditableScoreAsset(jobId, "midi");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${asset.downloadName}"`);
    const stream = await this.storage.openGeneratedStream(asset.storagePath);
    return stream.pipe(res);
  }
}
