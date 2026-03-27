-- CreateTable
CREATE TABLE "EditedScore" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "scoreJson" JSONB NOT NULL,
    "musicxmlPath" TEXT,
    "midiPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditedScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EditedScore_jobId_key" ON "EditedScore"("jobId");

-- AddForeignKey
ALTER TABLE "EditedScore" ADD CONSTRAINT "EditedScore_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TranscriptionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
