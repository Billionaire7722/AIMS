import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const runtimeEnv = await loadRuntimeEnv();
const apiBaseUrl = getApiBaseUrl(runtimeEnv);
const transcriberBaseUrl = getTranscriberBaseUrl(runtimeEnv);
const ffmpegPath = runtimeEnv.FFMPEG_PATH ?? "ffmpeg";
const sampleUrl =
  runtimeEnv.SMOKE_SAMPLE_URL ??
  "https://commons.wikimedia.org/wiki/Special:FilePath/Chopin%20-%20Waltz%20in%20E%20minor%2C%20B%2056.mp3";
const sampleFile = runtimeEnv.SMOKE_SAMPLE_FILE ? resolve(root, runtimeEnv.SMOKE_SAMPLE_FILE) : null;
const smokeDir = resolve(root, ".smoke-assets");
const rawSamplePath = join(smokeDir, "chopin-waltz-e-minor-full.mp3");
const clipSamplePath = join(smokeDir, "chopin-waltz-e-minor-clip.mp3");
const pollIntervalMs = Number(runtimeEnv.SMOKE_POLL_INTERVAL_MS ?? 5000);
const timeoutMs = Number(runtimeEnv.SMOKE_TIMEOUT_MS ?? 30 * 60 * 1000);
const deadline = Date.now() + timeoutMs;

async function main() {
  await mkdir(smokeDir, { recursive: true });
  await waitForHealth(`${apiBaseUrl}/api/health`, "API");
  await waitForHealth(`${transcriberBaseUrl}/health`, "Transcriber");
  await ensureTrimmedSample();

  const upload = await uploadFile(clipSamplePath);
  console.log(`Uploaded ${upload.fileName} -> ${upload.id}`);
  const job = await createJob(upload.id);
  console.log(`Queued job ${job.id}`);

  const completedJob = await waitForJob(job.id);
  const result = await fetchJson(`${apiBaseUrl}/api/results/${completedJob.id}`);
  validateResult(result);

  for (const asset of result.assets) {
    const musicxml = await fetchBinary(
      `${apiBaseUrl}/api/results/${completedJob.id}/musicxml?mode=${encodeURIComponent(asset.mode)}`,
    );
    const midi = await fetchBinary(`${apiBaseUrl}/api/results/${completedJob.id}/midi?mode=${encodeURIComponent(asset.mode)}`);
    if (musicxml.length === 0 || midi.length === 0) {
      throw new Error(`Asset download returned an empty file for mode ${asset.mode}.`);
    }
  }

  if (result.rawNotesUrl) {
    const rawNotes = await fetchJson(result.rawNotesUrl);
    if (!Array.isArray(rawNotes)) {
      throw new Error("Raw notes endpoint did not return an array.");
    }
  }

  console.log("End-to-end smoke test passed.");
  console.log(
    JSON.stringify(
      {
        tempoBpm: result.tempoBpm,
        timeSignature: result.timeSignature,
        lowestNote: result.lowestNote,
        highestNote: result.highestNote,
        repeatedSections: result.repeatedSections,
      },
      null,
      2,
    ),
  );
}

async function ensureTrimmedSample() {
  if (!(await exists(clipSamplePath))) {
    if (sampleFile) {
      if (!(await exists(sampleFile))) {
        throw new Error(`SMOKE_SAMPLE_FILE was set but the file does not exist: ${sampleFile}`);
      }
      await copySample(sampleFile, rawSamplePath);
    } else if (!(await exists(rawSamplePath))) {
      console.log(`Downloading sample from ${sampleUrl}`);
      const response = await fetch(sampleUrl);
      if (!response.ok) {
        throw new Error(`Failed to download sample audio: ${response.status} ${await response.text()}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(rawSamplePath, buffer);
    }

    console.log("Creating 25-second sample clip with FFmpeg");
    await runCommand(ffmpegPath, [
      "-y",
      "-i",
      rawSamplePath,
      "-ss",
      "0",
      "-t",
      "25",
      "-vn",
      "-map",
      "0:a:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      clipSamplePath,
    ]);
  }
}

async function uploadFile(filePath) {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "chopin-waltz-e-minor-clip.mp3");
  const response = await fetch(`${apiBaseUrl}/api/uploads`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function createJob(uploadId) {
  const response = await fetch(`${apiBaseUrl}/api/jobs/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uploadId,
      mode: "study-friendly",
    }),
  });
  if (!response.ok) {
    throw new Error(`Job creation failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForJob(jobId) {
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/api/jobs/${jobId}/status`);
    if (!response.ok) {
      throw new Error(`Polling failed: ${response.status} ${await response.text()}`);
    }
    const status = await response.json();
    console.log(`Job ${jobId}: ${status.status} (${status.progress}%)`);
    if (status.status === "completed") {
      return status;
    }
    if (status.status === "failed") {
      throw new Error(`Transcription failed: ${status.errorMessage ?? "unknown error"}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for job ${jobId}.`);
}

async function waitForHealth(url, label) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep retrying until timeout
    }
    await sleep(2000);
  }
  throw new Error(`${label} did not become healthy at ${url} before the timeout.`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binary download failed: ${response.status} ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function validateResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Result endpoint returned an invalid payload.");
  }
  for (const key of ["tempoBpm", "timeSignature", "lowestNote", "highestNote"]) {
    if (!(key in result)) {
      throw new Error(`Result payload is missing ${key}.`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exists(filePath) {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function copySample(source, destination) {
  const buffer = await readFile(source);
  await writeFile(destination, buffer);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function getApiBaseUrl() {
  const explicit = runtimeEnv.API_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const port = Number(runtimeEnv.API_PORT ?? 4000);
  return `http://127.0.0.1:${port}`;
}

function getTranscriberBaseUrl() {
  const explicit = runtimeEnv.TRANSCRIBER_URL ?? runtimeEnv.TRANSCRIBER_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const port = Number(runtimeEnv.TRANSCRIBER_PORT ?? 8001);
  return `http://127.0.0.1:${port}`;
}

async function loadRuntimeEnv() {
  const sources = [".env", "apps/api/.env", "services/transcriber/.env"];
  const merged = {};
  for (const source of sources) {
    const absolute = resolve(root, source);
    if (!(await exists(absolute))) {
      continue;
    }
    const contents = await readFile(absolute, "utf8");
    Object.assign(merged, parseEnvFile(contents));
  }
  return { ...merged, ...process.env };
}

function parseEnvFile(contents) {
  const result = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
