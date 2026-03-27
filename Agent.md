# Agent Guide

## Project architecture

This repository is a local-first monorepo for piano transcription and score rendering.

- `apps/api/`
  - NestJS + TypeScript orchestration API.
  - Key folders:
    - `src/` application code.
    - `src/modules/` feature modules such as `auth`, `uploads`, `jobs`, `results`, `feedback`, and `health`.
    - `src/prisma/`, `src/storage/`, `src/transcriber/`, `src/workspace/`, and `src/runtime/` shared backend services and startup logic.
    - `prisma/` Prisma schema and SQL migrations.
    - `scripts/` API-only build helpers.
    - `dist/` compiled output.
- `apps/web/`
  - React + Vite + TypeScript frontend.
  - Key files:
    - `src/App.tsx` main UI flow.
    - `src/SheetViewer.tsx` score rendering.
    - `src/api.ts` browser API client.
    - `src/main.tsx` app bootstrap.
    - `src/styles.css` styles.
    - `dist/` production build output.
- `services/transcriber/`
  - FastAPI + Python 3.11 transcription service.
  - Key folders/files:
    - `app/main.py` FastAPI entrypoint.
    - `app/core/` settings, models, dependency wiring, runtime checks, and state storage.
    - `app/services/` audio preprocessing, analysis, export, transcription, and pipeline logic.
    - `requirements.txt` Python dependencies.
    - `.venv/` local virtual environment.
- `packages/shared-types/`
  - Shared Zod schemas and TypeScript types used across apps.
  - Main file: `src/index.ts`.
- `packages/music-domain/`
  - Shared music-domain helpers such as MIDI/pitch conversion.
  - Main file: `src/index.ts`.
- `scripts/`
  - Repo-level helper scripts, currently including `local-e2e.mjs` for the smoke test.
- Runtime/data directories at the repo root:
  - `uploads/`, `generated-assets/`, `run-logs/`, and `.smoke-assets/` hold local artifacts.
  - `_aria_amt_tmp/` and `_aria_utils_tmp/` appear to be temporary local checkouts/work dirs.

## Code conventions

The repo does not currently include a checked-in ESLint or Prettier config, so follow the existing source style.

- TypeScript conventions:
  - Use strict TypeScript settings from `tsconfig.base.json`.
  - Use ESM-style imports with explicit `.js` extensions in backend TypeScript files.
  - Use `PascalCase` for React components and NestJS classes.
  - Use `camelCase` for functions, variables, and object properties.
  - Use `kebab-case` for many backend file names such as `transcriber-client.service.ts`.
  - Use semicolons and double quotes consistently.
  - Keep shared contracts in `packages/shared-types` and reuse them instead of duplicating request/response types.
- React/frontend conventions:
  - Keep UI logic in `src/App.tsx` and reusable view code in separate components like `SheetViewer.tsx`.
  - Prefer typed state and API responses.
- NestJS/backend conventions:
  - Organize code by feature module under `apps/api/src/modules`.
  - Keep service classes in `*.service.ts`, controllers in `*.controller.ts`, and modules in `*.module.ts`.
- Python conventions:
  - Use `snake_case` for functions, methods, and module names.
  - Keep typed Pydantic models in `app/core/models.py`.
  - Split pipeline logic into focused service modules under `app/services/`.

## Important rules

- Do not edit generated, runtime, or local-machine artifacts unless the task explicitly requires it:
  - `dist/`
  - `node_modules/`
  - `.venv/`
  - `__pycache__/`
  - `uploads/`
  - `generated-assets/`
  - `.smoke-assets/`
  - `run-logs/`
  - temporary folders such as `_aria_amt_tmp/` and `_aria_utils_tmp/`
- Treat `.env` files and local checkpoints as machine-specific. Do not commit secrets or paths from local setup.
- If you change shared request/response shapes, update `packages/shared-types` first and then align the API and web app with those contracts.
- If you change persistence behavior, check whether Prisma schema or migrations in `apps/api/prisma/` also need updates.
- Run the relevant verification commands before committing. At minimum, use the affected package typecheck/build command, and run the smoke test for end-to-end changes.

## Build and test commands

Run these from the repository root unless noted otherwise.

- Install dependencies:
  - `npm install --prefix packages/shared-types`
  - `npm install --prefix apps/api`
  - `npm install --prefix apps/web`
  - Python service: `pip install -r services/transcriber/requirements.txt`
- Development:
  - `npm run dev:web`
  - `npm run dev:api`
  - `npm run dev:transcriber`
- Database:
  - `npm run prisma:generate`
  - `npm run prisma:migrate`
- Build:
  - `npm run build`
  - `npm run build:api`
  - `npm run build:web`
- Typecheck / validation:
  - `npm run typecheck`
  - `npm run typecheck:api`
  - `npm run typecheck:web`
  - `npm run typecheck --prefix services/transcriber`
    - This runs `python -m compileall app` as a lightweight Python validation step.
- End-to-end smoke test:
  - `npm run e2e:smoke`

Notes:

- There is no dedicated unit-test command checked in yet.
- The transcriber should be started before the API.
- The smoke test depends on local PostgreSQL, Redis, FFmpeg, and the `aria-amt` checkpoint being configured.
