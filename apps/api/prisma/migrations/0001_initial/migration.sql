CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Upload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Upload_storagePath_key" ON "Upload"("storagePath");

CREATE TABLE "TranscriptionJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "transcriberJobId" TEXT,
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranscriptionJob_uploadId_key" ON "TranscriptionJob"("uploadId");

CREATE TABLE "TranscriptionResult" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "tempoBpm" DOUBLE PRECISION NOT NULL,
  "timeSignature" TEXT NOT NULL,
  "highestNote" TEXT NOT NULL,
  "lowestNote" TEXT NOT NULL,
  "repeatedSections" TEXT[] NOT NULL,
  "benchmark" JSONB NOT NULL,
  "notesCount" INTEGER NOT NULL,
  "rawNotesPath" TEXT,
  "selectedMode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptionResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranscriptionResult_jobId_key" ON "TranscriptionResult"("jobId");

CREATE TABLE "SheetAsset" (
  "id" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "assetType" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "downloadName" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SheetAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "projectId" TEXT,
  "jobId" TEXT NOT NULL,
  "resultId" TEXT,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "issueTags" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalysisFeedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Upload"
  ADD CONSTRAINT "Upload_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Upload"
  ADD CONSTRAINT "Upload_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptionResult"
  ADD CONSTRAINT "TranscriptionResult_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "TranscriptionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptionResult"
  ADD CONSTRAINT "TranscriptionResult_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SheetAsset"
  ADD CONSTRAINT "SheetAsset_resultId_fkey"
  FOREIGN KEY ("resultId") REFERENCES "TranscriptionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SheetAsset"
  ADD CONSTRAINT "SheetAsset_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "TranscriptionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalysisFeedback"
  ADD CONSTRAINT "AnalysisFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalysisFeedback"
  ADD CONSTRAINT "AnalysisFeedback_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnalysisFeedback"
  ADD CONSTRAINT "AnalysisFeedback_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "TranscriptionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalysisFeedback"
  ADD CONSTRAINT "AnalysisFeedback_resultId_fkey"
  FOREIGN KEY ("resultId") REFERENCES "TranscriptionResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
