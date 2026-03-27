# AIMS Piano Transcription Monorepo

Local-first monorepo for piano transcription, editable score correction, score generation, and web rendering.

The web app includes a v1 piano correction workspace:

- AI output is treated as a draft, not the final score
- Edits are made against an internal score model
- MusicXML and MIDI are regenerated from the edited score on save
- Playback runs from the edited score state so corrections can be heard immediately

## Included

- `apps/web` - React + Vite + TypeScript frontend
- `apps/api` - NestJS + TypeScript orchestration API
- `services/transcriber` - FastAPI + Python 3.11 transcription service
- `packages/shared-types` - shared request/response schemas
- `packages/music-domain` - score and notation helpers

## Local prerequisites

Install these on the host machine before starting the app:

- Node.js 20+
- npm 10+
- Python 3.11+
- MongoDB Atlas or another MongoDB deployment reachable via `DATABASE_URL`
- Redis 5.0+ running locally
- FFmpeg installed locally and available on `PATH`, or configured with `FFMPEG_PATH`
- An `aria-amt` checkpoint file, downloaded locally and referenced by `ARIA_AMT_CHECKPOINT_PATH`

## Service expectations

The app does not use Docker, and the only external service it depends on is the configured MongoDB deployment.

- MongoDB is used by the NestJS API through `DATABASE_URL`
- The transcriber stores its job state in the same MongoDB database
- Redis is used by BullMQ through `REDIS_HOST` and `REDIS_PORT`
- FFmpeg is used by the transcriber for preprocessing
- The Python service must start successfully before the API because the API checks the transcriber health endpoint on boot
- The transcriber service uses the local `aria-amt` CLI entrypoint and needs a checkpoint path before jobs can run

## Windows local setup

1. Open a terminal at the repository root.
2. Copy the env templates and adjust them for your machine:
   - `apps/api/.env.example` to `apps/api/.env`
   - `services/transcriber/.env.example` to `services/transcriber/.env`
   - `apps/web/.env.example` to `apps/web/.env`
3. Confirm your MongoDB connection string and Redis are set up.
   - BullMQ requires Redis 5.0 or newer
   - If your machine already has an older Redis service on `6379`, point the API at a newer local Redis instance instead
4. Create a Python virtual environment for the transcriber and install its dependencies:

```powershell
py -3.11 -m venv services/transcriber/.venv
services\transcriber\.venv\Scripts\Activate.ps1
pip install -r services/transcriber/requirements.txt
```

5. Install the Node dependencies for each package:

```powershell
npm install --prefix packages/shared-types
npm install --prefix apps/api
npm install --prefix apps/web
```

6. Push the Prisma schema to MongoDB:

```powershell
npm run prisma:push
```

7. Start the services in separate terminals:

```powershell
npm run dev:transcriber
npm run dev:api
npm run dev:web
```

The transcriber should start first. The API will fail fast if MongoDB, Redis, or the transcriber are not reachable.

## Environment variables

### API

`apps/api/.env` should define:

- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `API_PORT`
- `TRANSCRIBER_URL`
- `API_BASE_URL`
- `UPLOAD_DIR`
- `GENERATED_ASSETS_DIR`
- `JWT_SECRET`
- `CORS_ORIGIN`

### Transcriber

`services/transcriber/.env` should define:

- `TRANSCRIBER_PORT`
- `UPLOAD_DIR`
- `GENERATED_ASSETS_DIR`
- `FFMPEG_PATH`
- `PYTHON_ENV`
- `API_BASE_URL`
- `ARIA_AMT_BIN`
- `ARIA_AMT_CHECKPOINT_PATH`

### Web

`apps/web/.env` should define:

- `VITE_API_BASE_URL`

## Dependency checks

Before starting the app, verify the local runtime pieces:

```powershell
psql --version
redis-cli ping
ffmpeg -version
```

If `ffmpeg` is not on `PATH`, set `FFMPEG_PATH` in `services/transcriber/.env` to the full executable path.

If Redis is not reachable at the configured host and port, the API will fail startup with a clear message.

If MongoDB is not reachable at the configured `DATABASE_URL`, the API will fail startup with a clear message.

For `aria-amt`, set `ARIA_AMT_CHECKPOINT_PATH` to a local copy of the `piano-medium-double-1.0.safetensors` checkpoint before starting the transcriber. During local development on Windows, the `ARIA_AMT_BIN` path can point to `services/transcriber/.venv/Scripts/aria-amt.exe`.

If you are on Windows and using WSL-hosted Redis, make sure the API `REDIS_HOST` / `REDIS_PORT` pair matches the forwarded localhost port. This repo was validated with Redis 7 listening on `127.0.0.1:6380`.

## Smoke test

After the services are running, execute the local end-to-end smoke test:

```powershell
npm run e2e:smoke
```

The smoke test:

1. Waits for the API and transcriber health endpoints
2. Uses a real solo piano MP3 by default, or a local file if `SMOKE_SAMPLE_FILE` is set
3. Trims the source with FFmpeg
4. Uploads the file to the API
5. Creates a transcription job
6. Waits for completion
7. Verifies result, MusicXML, MIDI, and raw-notes endpoints

The local end-to-end smoke test has been run successfully against a real piano MP3 in this workspace.

You can point the smoke test at a local sample file with:

```powershell
$env:SMOKE_SAMPLE_FILE = "C:\path\to\your\piano-sample.mp3"
npm run e2e:smoke
```

## Common ports

- API: `API_PORT` default `4000`
- Transcriber: `TRANSCRIBER_PORT` default `8001`
- Web: `WEB_PORT` default `5173`

## Current flow

The intended local path is:

1. Upload MP3 or MP4 in the web app
2. API stores the file in MongoDB and creates a job
3. API enqueues the job with BullMQ
4. API worker calls the FastAPI transcriber service
5. Transcriber preprocesses, transcribes, tracks tempo, quantizes, splits staves, and exports MusicXML + MIDI
6. API stores job results and serves the generated draft assets back to the web app
7. The web app loads the editable score model, lets the user correct notes, and saves the edited version separately
8. Edited MusicXML and MIDI are regenerated from the internal score model and exposed as final exports

## Notes

- No Docker files are used anywhere in this repo.
- Uploads and generated score assets are stored in MongoDB GridFS, with local scratch files used only as transient transcriber I/O.
- The transcriber produces both `original` and `study-friendly` variants.
- The editable score model is the source of truth for correction, playback, and export. MusicXML is only an export format.
- The v1 editor intentionally focuses on practical piano correction workflow rather than full engraving completeness.
