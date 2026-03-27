import { z } from "zod";

export const outputModeSchema = z.enum(["original", "study-friendly"]);
export type OutputMode = z.infer<typeof outputModeSchema>;

export const scoreHandSchema = z.enum(["rh", "lh"]);
export type ScoreHand = z.infer<typeof scoreHandSchema>;

export const scoreSourceSchema = z.enum(["ai", "user"]);
export type ScoreSource = z.infer<typeof scoreSourceSchema>;

export const scoreVariantSchema = z.enum(["ai-draft", "user-edited", "final-export"]);
export type ScoreVariant = z.infer<typeof scoreVariantSchema>;

export const rawNoteEventSchema = z.object({
  pitch: z.number().int().min(0).max(127),
  startQl: z.number().nonnegative(),
  durationQl: z.number().positive(),
  velocity: z.number().int().min(1).max(127),
  confidence: z.number().min(0).max(1).optional().nullable(),
  hand: scoreHandSchema.optional().nullable(),
});
export type RawNoteEvent = z.infer<typeof rawNoteEventSchema>;

export const scoreAccidentalSchema = z.enum([
  "natural",
  "sharp",
  "flat",
  "double-sharp",
  "double-flat",
]);
export type ScoreAccidental = z.infer<typeof scoreAccidentalSchema>;

export const scoreTieFlagsSchema = z.object({
  start: z.boolean().default(false),
  stop: z.boolean().default(false),
});
export type ScoreTieFlags = z.infer<typeof scoreTieFlagsSchema>;

export const scoreNoteSchema = z.object({
  id: z.string().min(1),
  measureNumber: z.number().int().positive(),
  hand: scoreHandSchema,
  pitch: z.string().min(1),
  midiValue: z.number().int().min(0).max(127),
  startBeat: z.number().nonnegative(),
  durationBeats: z.number().positive(),
  accidental: scoreAccidentalSchema.optional().nullable(),
  tieFlags: scoreTieFlagsSchema.default({ start: false, stop: false }),
  chordId: z.string().min(1).optional().nullable(),
  source: scoreSourceSchema,
  confidence: z.number().min(0).max(1).optional().nullable(),
  isRest: z.boolean().default(false),
});
export type ScoreNote = z.infer<typeof scoreNoteSchema>;

export const scoreMeasureSchema = z.object({
  number: z.number().int().positive(),
  startBeat: z.number().nonnegative(),
  beatsPerMeasure: z.number().positive(),
  timeSignature: z.string().min(1),
  rightHandNotes: z.array(scoreNoteSchema).default([]),
  leftHandNotes: z.array(scoreNoteSchema).default([]),
  repeatStart: z.boolean().default(false),
  repeatEnd: z.boolean().default(false),
  barline: z.enum(["single", "double", "repeat-start", "repeat-end"]).default("single"),
});
export type ScoreMeasure = z.infer<typeof scoreMeasureSchema>;

export const editableScoreSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  title: z.string().min(1),
  sourceMode: outputModeSchema,
  variant: scoreVariantSchema,
  tempoBpm: z.number().positive(),
  timeSignature: z.string().min(1),
  keySignature: z.string().min(1),
  measureCount: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  measures: z.array(scoreMeasureSchema),
});
export type EditableScore = z.infer<typeof editableScoreSchema>;

export const editableScoreSaveSchema = editableScoreSchema;
export type EditableScoreSaveInput = z.infer<typeof editableScoreSaveSchema>;

export const editableScoreAssetsSchema = z.object({
  musicxmlUrl: z.string().url().nullable(),
  midiUrl: z.string().url().nullable(),
});
export type EditableScoreAssets = z.infer<typeof editableScoreAssetsSchema>;

export const editableScoreResponseSchema = editableScoreSchema.extend({
  assets: editableScoreAssetsSchema,
});
export type EditableScoreResponse = z.infer<typeof editableScoreResponseSchema>;

export const transcriptionStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>;

export const analysisFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(4000).optional().nullable(),
  issueTags: z.array(z.string().trim().min(1).max(80)).default([]),
});
export type AnalysisFeedbackInput = z.infer<typeof analysisFeedbackSchema>;

export const uploadResponseSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string(),
  createdAt: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const transcriptionJobCreateSchema = z.object({
  uploadId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  mode: outputModeSchema.default("study-friendly"),
});
export type TranscriptionJobCreateInput = z.infer<typeof transcriptionJobCreateSchema>;

export const transcriptionJobResponseSchema = z.object({
  id: z.string().uuid(),
  uploadId: z.string().uuid(),
  projectId: z.string().uuid(),
  status: transcriptionStatusSchema,
  progress: z.number().min(0).max(100),
  mode: outputModeSchema,
  transcriberJobId: z.string().uuid().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TranscriptionJobResponse = z.infer<typeof transcriptionJobResponseSchema>;

export const transcriptionResultAssetSchema = z.object({
  mode: outputModeSchema,
  musicxmlUrl: z.string().url(),
  midiUrl: z.string().url(),
});
export type TranscriptionResultAsset = z.infer<typeof transcriptionResultAssetSchema>;

export const transcriptionResultResponseSchema = z.object({
  jobId: z.string().uuid(),
  tempoBpm: z.number().positive(),
  timeSignature: z.string(),
  highestNote: z.string(),
  lowestNote: z.string(),
  repeatedSections: z.array(z.string()),
  benchmark: z.record(z.string(), z.number()),
  notesCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
  assets: z.array(transcriptionResultAssetSchema),
  rawNotesUrl: z.string().url().optional().nullable(),
});
export type TranscriptionResultResponse = z.infer<typeof transcriptionResultResponseSchema>;

export const transcriberAssetSchema = z.object({
  mode: outputModeSchema,
  musicxmlPath: z.string().min(1),
  midiPath: z.string().min(1),
  rawNotesPath: z.string().min(1).optional().nullable(),
});
export type TranscriberAsset = z.infer<typeof transcriberAssetSchema>;

export const transcriberResultSchema = z.object({
  jobId: z.string().uuid(),
  tempoBpm: z.number().positive(),
  timeSignature: z.string(),
  highestNote: z.string(),
  lowestNote: z.string(),
  repeatedSections: z.array(z.string()),
  benchmark: z.record(z.string(), z.number()),
  notesCount: z.number().int().nonnegative(),
  assets: z.array(transcriberAssetSchema),
  rawNotesPath: z.string().min(1).optional().nullable(),
});
export type TranscriberResult = z.infer<typeof transcriberResultSchema>;

export const transcriberJobCreateSchema = z.object({
  uploadPath: z.string().min(1),
  uploadFileName: z.string().min(1),
  outputRoot: z.string().min(1),
  mode: outputModeSchema,
  jobId: z.string().uuid(),
  callbackBaseUrl: z.string().url().optional(),
});
export type TranscriberJobCreateInput = z.infer<typeof transcriberJobCreateSchema>;

export const transcriberJobStatusSchema = z.object({
  id: z.string().uuid(),
  status: transcriptionStatusSchema,
  progress: z.number().min(0).max(100),
  stage: z.string(),
  message: z.string().optional().nullable(),
  result: transcriberResultSchema.optional().nullable(),
  errorMessage: z.string().optional().nullable(),
  benchmark: z.record(z.string(), z.number()).optional().default({}),
  updatedAt: z.string(),
});
export type TranscriberJobStatus = z.infer<typeof transcriberJobStatusSchema>;
