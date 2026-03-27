import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { EditableScoreResponse, OutputMode, TranscriptionResultResponse } from "@aims/shared-types";
import { createJob, fetchDraftScore, fetchEditableScore, fetchJob, fetchJobStatus, fetchResult, uploadMedia } from "./api";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PianoScoreEditor } from "./PianoScoreEditor";
import { noticeText, type Notice, useLanguage } from "./i18n";

type AppRoute =
  | { name: "upload" }
  | { name: "editor"; jobId: string | null };

type JobRecord = {
  id: string;
  uploadId: string;
  projectId: string;
  status: string;
  progress: number;
  mode: string;
  transcriberJobId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  upload?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
};

const LAST_JOB_STORAGE_KEY = "aims-last-job-id";

function parseRoute(pathname: string): AppRoute {
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  const editorMatch = /^\/editor\/([^/]+)$/.exec(cleanPath);
  if (editorMatch) {
    return { name: "editor", jobId: decodeURIComponent(editorMatch[1]) };
  }
  return { name: "upload" };
}

function routeToPath(route: AppRoute) {
  if (route.name === "editor" && route.jobId) {
    return `/editor/${encodeURIComponent(route.jobId)}`;
  }
  return "/upload";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${sizeBytes} B`;
}

export function App() {
  const { t } = useLanguage();
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === "undefined") {
      return { name: "upload" };
    }
    return parseRoute(window.location.pathname);
  });
  const [lastJobId, setLastJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(LAST_JOB_STORAGE_KEY);
  });

  useEffect(() => {
    function handlePopState() {
      setRoute(parseRoute(window.location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextRoute: AppRoute) {
    const path = routeToPath(nextRoute);
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setRoute(nextRoute);
  }

  function rememberJob(jobId: string) {
    setLastJobId(jobId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_JOB_STORAGE_KEY, jobId);
    }
  }

  const pageLabel = route.name === "editor" ? t.app.workspaceHeading : t.app.uploadHeading;

  return (
    <main className="app-frame">
      <header className="app-header">
        <div className="app-branding">
          <button type="button" className={`nav-chip ${route.name === "upload" ? "active" : ""}`} onClick={() => navigate({ name: "upload" })}>
            {t.app.uploadHeading}
          </button>
          <button
            type="button"
            className={`nav-chip ${route.name === "editor" ? "active" : ""}`}
            onClick={() => navigate({ name: "editor", jobId: lastJobId })}
            disabled={!lastJobId}
          >
            {t.app.workspaceHeading}
          </button>
          <div className="app-brand-copy">
            <span className="app-wordmark">AIMS</span>
            <p>{pageLabel}</p>
          </div>
        </div>
        <LanguageSwitcher compact />
      </header>

      <section className="app-view">
        {route.name === "upload" ? (
          <UploadPage
            lastJobId={lastJobId}
            onOpenEditor={(jobId) => {
              rememberJob(jobId);
              navigate({ name: "editor", jobId });
            }}
          />
        ) : (
          <EditorPage
            jobId={route.jobId ?? lastJobId}
            onRememberJob={rememberJob}
            onOpenUpload={() => navigate({ name: "upload" })}
          />
        )}
      </section>
    </main>
  );
}

function UploadPage({
  lastJobId,
  onOpenEditor,
}: {
  lastJobId: string | null;
  onOpenEditor: (jobId: string) => void;
}) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("");
  const [selectedMode, setSelectedMode] = useState<OutputMode>("study-friendly");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const [error, setError] = useState<Notice | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError({ key: "chooseFileFirst" });
      return;
    }

    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const upload = await uploadMedia(file, projectId.trim() || undefined);
      setMessage({ key: "uploadingFile", values: { fileName: upload.fileName } });
      const job = await createJob(upload.id, selectedMode);
      onOpenEditor(job.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? { raw: submitError.message } : { key: "uploadFailed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="upload-page">
      <div className="utility-panel upload-form-panel">
        <div className="section-heading">
          <p className="section-label">{t.app.uploadHeading}</p>
          <h1>{t.app.title}</h1>
          <p className="section-copy">{t.app.lede}</p>
        </div>

        <form className="upload-form" onSubmit={handleSubmit}>
          <label>
            {t.app.projectIdLabel}
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder={t.app.projectIdPlaceholder}
            />
          </label>

          <label>
            {t.app.fileLabel}
            <input
              type="file"
              accept=".mp3,.mp4,audio/mpeg,video/mp4,audio/mp4"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <label>
            {t.app.transcriptionModeLabel}
            <select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as OutputMode)}>
              <option value="study-friendly">{t.outputModes["study-friendly"]}</option>
              <option value="original">{t.outputModes.original}</option>
            </select>
          </label>

          <div className="info-block">
            <strong>{t.outputModes[selectedMode]}</strong>
            <p>{t.outputModeDescriptions[selectedMode]}</p>
          </div>

          {file ? (
            <div className="data-list">
              <div>
                <span>{t.app.fileLabel}</span>
                <strong>{file.name}</strong>
              </div>
              <div>
                <span>{t.common.status}</span>
                <strong>{uploading ? t.common.processing : t.common.ready}</strong>
              </div>
            </div>
          ) : null}

          {message ? <p className="inline-message success">{noticeText(message, t)}</p> : null}
          {error ? <p className="inline-message error">{noticeText(error, t)}</p> : null}

          <div className="inline-actions">
            <button type="submit" className="primary-action" disabled={uploading}>
              {uploading ? t.app.processingButton : t.app.startButton}
            </button>
            {lastJobId ? (
              <button type="button" className="secondary-action" onClick={() => onOpenEditor(lastJobId)}>
                {t.app.workspaceHeading}
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="utility-panel upload-side-panel">
        <div className="mini-stat-grid">
          <div className="mini-stat">
            <span>{t.outputModes.original}</span>
            <strong>{t.variants["ai-draft"]}</strong>
            <p>{t.outputModeDescriptions.original}</p>
          </div>
          <div className="mini-stat">
            <span>{t.outputModes["study-friendly"]}</span>
            <strong>{t.editor.title}</strong>
            <p>{t.outputModeDescriptions["study-friendly"]}</p>
          </div>
        </div>

        <div className="info-block">
          <strong>{t.app.workspaceHeading}</strong>
          <p>{t.app.workspaceDescription}</p>
        </div>

        <div className="info-block">
          <strong>{t.editor.editedExportHeading}</strong>
          <p>{t.editor.editedExportHint}</p>
        </div>
      </div>
    </section>
  );
}

function EditorPage({
  jobId,
  onRememberJob,
  onOpenUpload,
}: {
  jobId: string | null;
  onRememberJob: (jobId: string) => void;
  onOpenUpload: () => void;
}) {
  const { t } = useLanguage();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<TranscriptionResultResponse | null>(null);
  const [editableScore, setEditableScore] = useState<EditableScoreResponse | null>(null);
  const [debugScore, setDebugScore] = useState<EditableScoreResponse | null>(null);
  const [error, setError] = useState<Notice | null>(null);

  const jobSummary = useMemo(() => {
    if (!job) {
      return t.jobs.noJob;
    }
    const statusLabel = t.jobs.statusLabels[job.status as keyof typeof t.jobs.statusLabels] ?? job.status;
    return `${statusLabel} | ${job.progress}%`;
  }, [job, t]);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setResult(null);
      setEditableScore(null);
      setDebugScore(null);
      return;
    }
    const resolvedJobId = jobId;

    let cancelled = false;
    async function loadInitial() {
      try {
        const nextJob = await fetchJob(resolvedJobId);
        if (cancelled) {
          return;
        }
        setJob(nextJob);
        onRememberJob(resolvedJobId);
        if (nextJob.status === "completed") {
          const [nextResult, nextEditableScore, nextDebugScore] = await Promise.all([
            fetchResult(resolvedJobId),
            fetchEditableScore(resolvedJobId),
            fetchDraftScore(resolvedJobId, "original"),
          ]);
          if (cancelled) {
            return;
          }
          setResult(nextResult);
          setEditableScore(nextEditableScore);
          setDebugScore(nextDebugScore);
        } else {
          setResult(null);
          setEditableScore(null);
          setDebugScore(null);
        }
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? { raw: loadError.message } : { key: "failedToPollJobStatus" });
        }
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [jobId, onRememberJob]);

  useEffect(() => {
    if (!jobId || !job || job.status === "completed" || job.status === "failed") {
      return;
    }
    const resolvedJobId = jobId;

    const timer = window.setInterval(async () => {
      try {
        const status = await fetchJobStatus(resolvedJobId);
        setJob((current) => (current ? { ...current, ...status } : current));
        if (status.status === "completed") {
          const [nextJob, nextResult, nextEditableScore, nextDebugScore] = await Promise.all([
            fetchJob(resolvedJobId),
            fetchResult(resolvedJobId),
            fetchEditableScore(resolvedJobId),
            fetchDraftScore(resolvedJobId, "original"),
          ]);
          setJob(nextJob);
          setResult(nextResult);
          setEditableScore(nextEditableScore);
          setDebugScore(nextDebugScore);
          setError(null);
        } else if (status.status === "failed") {
          setError(status.errorMessage ? { raw: status.errorMessage } : { key: "transcriptionFailed" });
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? { raw: pollError.message } : { key: "failedToPollJobStatus" });
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [job, jobId]);

  if (!jobId) {
    return (
      <section className="editor-empty-state utility-panel">
        <div className="section-heading">
          <p className="section-label">{t.app.workspaceHeading}</p>
          <h1>{t.app.noScoreLoadedHeading}</h1>
          <p className="section-copy">{t.app.waitingForTranscriptionBody}</p>
        </div>
        <div className="inline-actions">
          <button type="button" className="primary-action" onClick={onOpenUpload}>
            {t.app.uploadHeading}
          </button>
        </div>
      </section>
    );
  }

  if (!job || !result || !editableScore || !debugScore) {
    return (
      <section className="editor-loading-state">
        <div className="utility-panel loading-panel">
          <div className="section-heading">
            <p className="section-label">{t.app.workspaceHeading}</p>
            <h1>{job ? t.app.waitingForTranscriptionHeading : t.app.noScoreLoadedHeading}</h1>
            <p className="section-copy">{job ? t.app.waitingForTranscriptionBody : t.app.workspaceDescription}</p>
          </div>

          <div className="data-list">
            <div>
              <span>{t.common.status}</span>
              <strong>{jobSummary}</strong>
            </div>
              <div>
                <span>{t.app.fileLabel}</span>
                <strong>{job?.upload?.fileName ?? t.common.pending}</strong>
              </div>
            <div>
              <span>{t.app.transcriptionModeLabel}</span>
              <strong>{job ? t.outputModes[job.mode as OutputMode] : t.common.pending}</strong>
            </div>
          </div>

          {job?.upload ? (
            <div className="info-block">
              <strong>{job.upload.fileName}</strong>
              <p>{formatFileSize(job.upload.sizeBytes)} | {job.upload.mimeType}</p>
            </div>
          ) : null}

          {error ? <p className="inline-message error">{noticeText(error, t)}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <PianoScoreEditor
      jobId={jobId}
      fileName={job.upload?.fileName ?? editableScore.title}
      result={result}
      initialScore={editableScore}
      debugScore={debugScore}
    />
  );
}
