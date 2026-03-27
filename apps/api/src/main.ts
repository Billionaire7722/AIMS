import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import os from "node:os";
import { AppModule } from "./app.module.js";
import { getAppEnv } from "./runtime/app-env.js";

function buildAllowedOrigins(configuredOrigin: string): string[] {
  const normalized = configuredOrigin.replace(/\/$/, "");
  const allowed = new Set<string>([normalized]);

  try {
    const parsed = new URL(normalized);
    const protocol = parsed.protocol;
    const port = parsed.port;

    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      allowed.add(`${protocol}//localhost${port ? `:${port}` : ""}`);
      allowed.add(`${protocol}//127.0.0.1${port ? `:${port}` : ""}`);
    }

    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== "IPv4" || entry.internal) {
          continue;
        }
        allowed.add(`${protocol}//${entry.address}${port ? `:${port}` : ""}`);
      }
    }
  } catch {
    // Keep the configured origin only if it is not a valid URL.
  }

  return Array.from(allowed);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  const env = getAppEnv();
  const allowedOrigins = buildAllowedOrigins(env.CORS_ORIGIN);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");

  await app.listen(Number(process.env.API_PORT ?? 4000), "0.0.0.0");
  console.log(`API listening on http://localhost:${Number(process.env.API_PORT ?? 4000)}`);
}

void bootstrap();
