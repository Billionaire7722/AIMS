import {
  analysisFeedbackSchema,
  transcriptionJobCreateSchema,
  uploadResponseSchema,
  transcriptionResultResponseSchema,
  transcriptionJobResponseSchema,
  editableScoreResponseSchema,
  editableScoreSaveSchema,
} from "@aims/shared-types";
import type { EditableScoreSaveInput, EditableScoreResponse } from "@aims/shared-types";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    ...init,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

export async function uploadMedia(file: File, projectId?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (projectId) {
    formData.append("projectId", projectId);
  }
  const response = await fetch(`${apiBaseUrl}/api/uploads`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return uploadResponseSchema.parse(await response.json());
}

export async function createJob(uploadId: string, mode: "original" | "study-friendly") {
  const response = await fetch(`${apiBaseUrl}/api/jobs/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, mode }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return transcriptionJobResponseSchema.parse(await response.json());
}

export async function fetchJobStatus(jobId: string) {
  return request<{
    id: string;
    status: string;
    progress: number;
    mode: string;
    transcriberJobId?: string | null;
    stage?: string | null;
    message?: string | null;
    errorMessage?: string | null;
    createdAt: string;
    updatedAt: string;
  }>(`/jobs/${jobId}/status`);
}

export async function fetchResult(jobId: string) {
  return transcriptionResultResponseSchema.parse(await request(`/results/${jobId}`));
}

export async function fetchEditableScore(jobId: string): Promise<EditableScoreResponse> {
  return editableScoreResponseSchema.parse(await request(`/results/${jobId}/editor-score`));
}

export async function saveEditableScore(jobId: string, score: EditableScoreSaveInput): Promise<EditableScoreResponse> {
  const payload = editableScoreSaveSchema.parse(score);
  return editableScoreResponseSchema.parse(
    await request(`/results/${jobId}/editor-score`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function sendFeedback(jobId: string, body: unknown) {
  return request(`/results/${jobId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
