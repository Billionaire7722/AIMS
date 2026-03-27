# AIMS Piano Transcription Monorepo

Local-first monorepo for piano audio to editable piano score correction.

The product is intentionally organized as a correction workspace, not a landing page. AI output is treated as a draft, the internal score model is the source of truth, and edited exports are regenerated from the saved edited score state.

## Included

- `apps/web` - React + Vite + TypeScript workspace UI
- `apps/api` - NestJS + TypeScript orchestration API
- `services/transcriber` - FastAPI + Python transcription processor
- `packages/shared-types` - shared request and response schemas
- `packages/music-domain` - internal score and export helpers

## Core runtime structure

- `/upload` is the transcription entry page
- `/editor/:jobId` is the desktop-first correction workspace
- MongoDB is the active database through NestJS + Mongoose
- Redis is used for local BullMQ job queueing
- Audio uploads and generated MusicXML or MIDI files stay on the local filesystem
- The Python transcriber does processing only; persistence lives in the API

## MongoDB data model

The active runtime stores document data in MongoDB collections that mirror the editor model:

- `users`
- `projects`
- `uploads`
- `transcriptionJobs`
- `scores`

### `scores` collection

Each saved score document stores the internal editor model directly, rather than treating MusicXML as the primary editable source.

Important fields:

- `jobId`
- `projectId`
- `uploadId`
- `sourceMode`
- `variant`
- `title`
- `tempoBpm`
- `timeSignature`
- `keySignature`
- `measureCount`
- `version`
- `noteCount`
- `range`
- `status`
- `isCurrent`
- `basedOnScoreId`
- `measures`
- `musicxmlPath`
- `midiPath`
- `createdAt`
- `updatedAt`

`variant` is used to separate AI draft scores from user-edited scores:

- `ai-draft`
- `user-edited`

`sourceMode` is used to separate the debug draft from the study-friendly score:

- `original`
- `study-friendly`

## Local prerequisites

Install these on the host machine before starting the app:

- Node.js 20+
- npm 10+
- Python 3.11+
- A MongoDB deployment reachable via `MONGODB_URI`
- Redis 5.0+ running locally
- FFmpeg on `PATH` or configured with `FFMPEG_PATH`
- A local `aria-amt` checkpoint referenced by `ARIA_AMT_CHECKPOINT_PATH`

No Docker is used or required.

## Environment variables

Copy the env templates and fill them in for your machine:

- [apps/api/.env.example](/D:/AIMS/apps/api/.env.example)
- [services/transcriber/.env.example](/D:/AIMS/services/transcriber/.env.example)
- [apps/web/.env.example](/D:/AIMS/apps/web/.env.example)

### API env

`apps/api/.env` should define:

- `MONGODB_URI`
- `REDIS_HOST`
- `REDIS_PORT`
- `API_PORT`
- `TRANSCRIBER_URL`
- `API_BASE_URL`
- `UPLOAD_DIR`
- `GENERATED_ASSETS_DIR`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `LOCAL_DEV_USER_EMAIL`
- `LOCAL_DEV_PROJECT_NAME`

### Transcriber env

`services/transcriber/.env` should define:

- `TRANSCRIBER_PORT`
- `UPLOAD_DIR`
- `GENERATED_ASSETS_DIR`
- `FFMPEG_PATH`
- `PYTHON_ENV`
- `API_BASE_URL`
- `ARIA_AMT_BIN`
- `ARIA_AMT_CHECKPOINT_PATH`

### Web env

`apps/web/.env` should define:

- `VITE_API_BASE_URL`
- `WEB_PORT`

## Windows local setup

1. Create the env files from the examples.
2. Create the transcriber virtual environment and install Python dependencies:

```powershell
py -3.11 -m venv services/transcriber/.venv
services\transcriber\.venv\Scripts\Activate.ps1
pip install -r services/transcriber/requirements.txt
```

3. Install the package dependencies:

```powershell
npm install
npm install --prefix apps/api
npm install --prefix apps/web
npm install --prefix packages/shared-types
```

4. Start the services in separate terminals:

```powershell
npm run dev:transcriber
npm run dev:api
npm run dev:web
```

The transcriber launcher now prefers `services/transcriber/.venv` automatically when it exists. Start the transcriber first, then the API, then the web app.

## Two-click local testing

After the one-time setup is done, you can run the app for testing with a double-click:

- [Start AIMS Local Test.bat](/D:/AIMS/Start%20AIMS%20Local%20Test.bat) starts the transcriber, API, and web app if they are not already running, waits for health checks, and opens the upload page in your browser.
- [Stop AIMS Local Test.bat](/D:/AIMS/Stop%20AIMS%20Local%20Test.bat) stops the web, API, and transcriber processes bound to the configured ports.

The launcher writes service logs to `run-logs`.

## Storage and persistence rules

- MongoDB stores metadata, jobs, and score documents
- Large binary media is not stored inside MongoDB
- Uploads stay under `UPLOAD_DIR`
- Generated draft and edited assets stay under `GENERATED_ASSETS_DIR`
- Draft MusicXML and MIDI paths are stored as metadata only
- Edited MusicXML and MIDI paths are stored as metadata only

## Score pipeline rules

- The app keeps raw debug and study-friendly score modes separate
- The study-friendly editor works from a cleaned internal score model
- Internal part labels exposed to users are `Piano RH` and `Piano LH`
- MusicXML is an export format, not the primary editable source
- Edited exports come from the saved edited score state, not the raw AI draft

## Smoke test

After the services are running, execute the local end-to-end smoke test:

```powershell
npm run e2e:smoke
```

The smoke test validates the local-first flow:

1. Waits for the API and transcriber health endpoints
2. Downloads or reuses a real piano sample and trims it with FFmpeg
3. Uploads the audio file
4. Creates a transcription job
5. Waits for job completion
6. Verifies MongoDB-backed result metadata
7. Loads the editable score
8. Saves an edited score version
9. Reloads the edited score and checks that the saved state persisted
10. Verifies regenerated edited MusicXML and MIDI downloads

You can point the smoke test at a local sample file with:

```powershell
$env:SMOKE_SAMPLE_FILE = "C:\path\to\your\piano-sample.mp3"
npm run e2e:smoke
```

## Current workflow

1. Upload piano audio from the upload page
2. Create a transcription job
3. Review the AI draft as a draft only
4. Open the study-friendly editor workspace
5. Correct notes against the internal score model
6. Save the edited score as a separate version
7. Export draft or edited assets explicitly

## Notes

- No PostgreSQL or Prisma migration steps remain in the active runtime path
- No GridFS storage is used in the active runtime path
- No Docker files or Docker setup are required
- The editor is intentionally desktop-first and correction-focused
