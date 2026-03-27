import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { EditableScoreResponse, OutputMode, TranscriptionResultResponse } from "@aims/shared-types";
import { createJob, fetchEditableScore, fetchJobStatus, fetchResult, getApiBaseUrl, uploadMedia } from "./api";
import { PianoScoreEditor } from "./PianoScoreEditor";

type JobProgress = {
  id: string;
  status: string;
  progress: number;
  mode: string;
  stage?: string | null;
  message?: string | null;
  errorMessage?: string | null;
};

const modeLabel: Record<OutputMode, string> = {
  "study-friendly": "Study-Friendly Notation",
  original: "Raw Transcription (Debug)",
};

const modeDescription: Record<OutputMode, string> = {
  "study-friendly": "Cleaner piano-facing notation with a practical correction workflow.",
  original: "Diagnostic reduction of the raw transcription. Useful for debugging, not polished study notation.",
};

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<TranscriptionResultResponse | null>(null);
  const [editableScore, setEditableScore] = useState<EditableScoreResponse | null>(null);
  const [selectedMode, setSelectedMode] = useState<OutputMode>("study-friendly");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editorReady = Boolean(result && editableScore && job?.status === "completed");

  const jobSummary = useMemo(() => {
    if (!job) {
      return "No transcription running yet.";
    }
    return `${job.status} | ${job.progress}%`;
  }, [job]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const status = await fetchJobStatus(job.id);
        setJob(status);
        if (status.status === "completed") {
          const [nextResult, nextScore] = await Promise.all([fetchResult(job.id), fetchEditableScore(job.id)]);
          setResult(nextResult);
          setEditableScore(nextScore);
          setMessage("Transcription finished. The draft score is ready to edit.");
        } else if (status.status === "failed") {
          setError(status.errorMessage ?? "Transcription failed.");
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to poll job status.");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose an MP3 or MP4 file first.");
      return;
    }
    const normalizedProjectId = projectId.trim();
    setError(null);
    setMessage(null);
    setUploading(true);
    setResult(null);
    setEditableScore(null);
    setJob(null);
    try {
      const upload = await uploadMedia(file, normalizedProjectId || undefined);
      setMessage(`Uploaded ${upload.fileName}. Creating transcription job...`);
      const nextJob = await createJob(upload.id, selectedMode);
      setJob(nextJob);
      setMessage(`Job ${nextJob.id} queued.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSendFeedback() {
    if (!job) {
      return;
    }
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/results/${job.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          comment: feedbackComment || null,
          issueTags: [],
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setMessage("Feedback saved.");
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : "Failed to save feedback.");
    }
  }

  const tempoText = result ? `${result.tempoBpm.toFixed(1)} BPM` : "Pending";
  const rangeText = result ? `${result.lowestNote} - ${result.highestNote}` : "Pending";
  const notesText = result ? `${result.notesCount} notes` : "Pending";

  return (
    <main className="page app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AIMS piano transcription</p>
          <h1>Correct the AI draft directly in the browser.</h1>
          <p className="lede">
            Upload audio, run transcription, then edit the resulting piano score inside a lightweight correction workspace.
            The AI result stays visible as a draft, while the edited version saves and exports separately.
          </p>
        </div>
        <div className="hero-card">
          <div>
            <span>Status</span>
            <strong>{jobSummary}</strong>
          </div>
          <div>
            <span>Tempo</span>
            <strong>{tempoText}</strong>
          </div>
          <div>
            <span>Range</span>
            <strong>{rangeText}</strong>
          </div>
          <div>
            <span>Notes</span>
            <strong>{notesText}</strong>
          </div>
        </div>
      </section>

      <section className="content-grid editor-grid-shell">
        <form className="panel upload-panel" onSubmit={handleSubmit}>
          <h2>Upload</h2>
          <label>
            Project ID
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="Optional existing project id, or leave blank"
            />
          </label>
          <label>
            File
            <input
              type="file"
              accept=".mp3,.mp4,audio/mpeg,video/mp4"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Transcription mode
            <select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as OutputMode)}>
              <option value="study-friendly">Study-friendly notation</option>
              <option value="original">Raw transcription (debug)</option>
            </select>
          </label>
          <div className="mode-copy">
            <strong>{modeLabel[selectedMode]}</strong>
            <p className="hint">{modeDescription[selectedMode]}</p>
          </div>
          <button type="submit" disabled={uploading}>
            {uploading ? "Processing..." : "Start transcription"}
          </button>
          <p className="hint">API: {getApiBaseUrl()}</p>
          {message ? <p className="success">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {job ? (
            <div className="job-status">
              <div className="job-status-row">
                <strong>{job.status}</strong>
                <span>{job.progress}%</span>
              </div>
              {job.stage ? <p className="hint">Stage: {job.stage}</p> : null}
              {job.message ? <p className="hint">{job.message}</p> : null}
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${job.progress}%` }} />
              </div>
              {job.errorMessage ? <p className="error">{job.errorMessage}</p> : null}
            </div>
          ) : null}
        </form>

        <section className="panel workspace-panel">
          <div className="panel-header">
            <div>
              <h2>Editor workspace</h2>
              <p className="hint">The draft score, playback, and export flow live here once transcription completes.</p>
            </div>
            {result ? (
              <span className={`status-badge ${editorReady ? "edited" : "draft"}`}>{editorReady ? "Editor ready" : "Loading editor"}</span>
            ) : null}
          </div>

          {job && result && editableScore ? (
            <PianoScoreEditor jobId={job.id} result={result} initialScore={editableScore} />
          ) : (
            <div className="empty-editor">
              <h3>{job ? "Waiting for transcription" : "No score loaded yet"}</h3>
              <p className="hint">
                When the job completes, the app will fetch the editable score model and open the correction workspace here.
              </p>
            </div>
          )}
        </section>
      </section>

      {result ? (
        <section className="panel feedback-panel">
          <h2>Analysis feedback</h2>
          <div className="feedback-grid">
            <label>
              Rating
              <input
                type="range"
                min="1"
                max="5"
                value={feedbackRating}
                onChange={(event) => setFeedbackRating(Number(event.target.value))}
              />
              <span>{feedbackRating}/5</span>
            </label>
            <label>
              Comment
              <textarea
                rows={4}
                value={feedbackComment}
                onChange={(event) => setFeedbackComment(event.target.value)}
                placeholder="What should be improved?"
              />
            </label>
          </div>
          <button type="button" onClick={handleSendFeedback}>
            Save feedback
          </button>
          <details>
            <summary>Repeated sections</summary>
            <ul>
              {result.repeatedSections.length > 0 ? result.repeatedSections.map((section) => <li key={section}>{section}</li>) : <li>No repeated sections detected.</li>}
            </ul>
          </details>
          <details>
            <summary>Benchmark</summary>
            <ul>
              {Object.entries(result.benchmark).map(([key, value]) => (
                <li key={key}>
                  {key}: {value.toFixed(3)}s
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </main>
  );
}
