import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { EditableScore, OutputMode, ScoreVariant, TranscriptionStatus } from "@aims/shared-types";

type ScoreRange = {
  lowest: string;
  highest: string;
};

@Schema({
  _id: false,
  versionKey: false,
})
export class JobAsset {
  @Prop({ required: true, enum: ["original", "study-friendly"] })
  mode!: OutputMode;

  @Prop({ required: true })
  musicxmlPath!: string;

  @Prop({ required: true })
  midiPath!: string;
}

@Schema({
  _id: false,
  versionKey: false,
})
export class JobFeedbackEntry {
  @Prop({ type: String, default: () => randomUUID() })
  id!: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ type: [String], default: [] })
  issueTags!: string[];

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;
}

@Schema({
  _id: false,
  versionKey: false,
})
export class JobResult {
  @Prop({ required: true })
  tempoBpm!: number;

  @Prop({ required: true })
  timeSignature!: string;

  @Prop({ required: true })
  keySignature!: string;

  @Prop({ required: true })
  highestNote!: string;

  @Prop({ required: true })
  lowestNote!: string;

  @Prop({ type: [String], default: [] })
  repeatedSections!: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  benchmark!: Record<string, number>;

  @Prop({ required: true, min: 0 })
  notesCount!: number;

  @Prop({ type: [String], default: [] })
  warnings!: string[];

  @Prop({ type: String, default: null })
  rawNotesPath!: string | null;

  @Prop({ type: String, default: null })
  debugNotesPath!: string | null;

  @Prop({ type: String, default: null })
  studyNotesPath!: string | null;

  @Prop({ type: [JobAsset], default: [] })
  assets!: JobAsset[];
}

@Schema({
  collection: "users",
  timestamps: true,
  versionKey: false,
})
export class UserEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true, unique: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ type: String, default: null })
  displayName!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: "projects",
  timestamps: true,
  versionKey: false,
})
export class ProjectEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true })
  ownerId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: "uploads",
  timestamps: true,
  versionKey: false,
})
export class UploadEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  projectId!: string;

  @Prop({ required: true })
  originalName!: string;

  @Prop({ required: true })
  storedName!: string;

  @Prop({ required: true, unique: true })
  storagePath!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  sizeBytes!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: "transcriptionJobs",
  timestamps: true,
  versionKey: false,
})
export class TranscriptionJobEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  projectId!: string;

  @Prop({ required: true, unique: true })
  uploadId!: string;

  @Prop({ required: true, enum: ["original", "study-friendly"] })
  mode!: OutputMode;

  @Prop({ required: true, enum: ["queued", "processing", "completed", "failed"], default: "queued" })
  status!: TranscriptionStatus;

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  progress!: number;

  @Prop({ type: String, default: null })
  transcriberJobId!: string | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: Date, default: () => new Date() })
  requestedAt!: Date;

  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  modelInfo!: Record<string, string | number | boolean | null> | null;

  @Prop({ type: JobResult, default: null })
  result!: JobResult | null;

  @Prop({ type: [JobFeedbackEntry], default: [] })
  feedback!: JobFeedbackEntry[];

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: "scores",
  timestamps: true,
  versionKey: false,
})
export class ScoreEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true })
  jobId!: string;

  @Prop({ required: true })
  projectId!: string;

  @Prop({ required: true })
  uploadId!: string;

  @Prop({ required: true, enum: ["original", "study-friendly"] })
  sourceMode!: OutputMode;

  @Prop({ required: true, enum: ["ai-draft", "user-edited", "final-export"] })
  variant!: ScoreVariant;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  tempoBpm!: number;

  @Prop({ required: true })
  timeSignature!: string;

  @Prop({ required: true })
  keySignature!: string;

  @Prop({ required: true, min: 1 })
  measureCount!: number;

  @Prop({ required: true, min: 0 })
  version!: number;

  @Prop({ required: true, min: 0 })
  noteCount!: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  range!: ScoreRange;

  @Prop({ required: true, enum: ["draft", "saved"], default: "draft" })
  status!: "draft" | "saved";

  @Prop({ type: Boolean, default: true })
  isCurrent!: boolean;

  @Prop({ type: String, default: null })
  basedOnScoreId!: string | null;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  measures!: EditableScore["measures"];

  @Prop({ type: String, default: null })
  musicxmlPath!: string | null;

  @Prop({ type: String, default: null })
  midiPath!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<UserEntity>;
export type ProjectDocument = HydratedDocument<ProjectEntity>;
export type UploadDocument = HydratedDocument<UploadEntity>;
export type TranscriptionJobDocument = HydratedDocument<TranscriptionJobEntity>;
export type ScoreDocument = HydratedDocument<ScoreEntity>;

export const UserSchema = SchemaFactory.createForClass(UserEntity);
export const ProjectSchema = SchemaFactory.createForClass(ProjectEntity);
export const UploadSchema = SchemaFactory.createForClass(UploadEntity);
export const TranscriptionJobSchema = SchemaFactory.createForClass(TranscriptionJobEntity);
export const ScoreSchema = SchemaFactory.createForClass(ScoreEntity);

ProjectSchema.index({ ownerId: 1, name: 1 }, { unique: true });
UploadSchema.index({ projectId: 1, createdAt: -1 });
TranscriptionJobSchema.index({ projectId: 1, createdAt: -1 });
ScoreSchema.index({ jobId: 1, sourceMode: 1, variant: 1, isCurrent: 1 });
ScoreSchema.index({ jobId: 1, variant: 1, version: -1 });
