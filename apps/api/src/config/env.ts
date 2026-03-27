import { z } from "zod";
import path from "node:path";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  API_PORT: z.coerce.number().int().positive().default(4000),
  TRANSCRIBER_URL: z.string().default("http://127.0.0.1:8001"),
  API_BASE_URL: z.string().default("http://127.0.0.1:4000"),
  UPLOAD_DIR: z.string().default(path.resolve(process.cwd(), "../../uploads")),
  GENERATED_ASSETS_DIR: z.string().default(path.resolve(process.cwd(), "../../generated-assets")),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LOCAL_DEV_USER_EMAIL: z.string().email().default("local-dev@aims.local"),
  LOCAL_DEV_PROJECT_NAME: z.string().default("Local Piano Project"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function envValidation(env: Record<string, unknown>) {
  return envSchema.parse(env);
}

export function buildEnvConfig() {
  return {
    app: envSchema.parse(process.env),
  };
}
