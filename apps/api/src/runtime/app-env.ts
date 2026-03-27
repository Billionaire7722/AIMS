import path from "node:path";

export function getAppEnv() {
  return {
    REDIS_HOST: process.env.REDIS_HOST ?? "127.0.0.1",
    REDIS_PORT: Number(process.env.REDIS_PORT ?? 6379),
    TRANSCRIBER_URL: (process.env.TRANSCRIBER_URL ?? "http://127.0.0.1:8001").replace(/\/$/, ""),
    API_BASE_URL: (process.env.API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
    UPLOAD_DIR: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "../../uploads"),
    GENERATED_ASSETS_DIR: process.env.GENERATED_ASSETS_DIR ?? path.resolve(process.cwd(), "../../generated-assets"),
    JWT_SECRET: process.env.JWT_SECRET ?? "",
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    LOCAL_DEV_USER_EMAIL: process.env.LOCAL_DEV_USER_EMAIL ?? "local-dev@aims.local",
    LOCAL_DEV_PROJECT_NAME: process.env.LOCAL_DEV_PROJECT_NAME ?? "Local Piano Project",
  };
}
