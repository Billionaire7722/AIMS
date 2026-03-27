import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import IORedis from "ioredis";
import { getAppEnv } from "./app-env.js";

@Injectable()
export class DependencyChecksService implements OnModuleInit {
  private readonly logger = new Logger(DependencyChecksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.checkStartupDependencies(true);
  }

  async checkStartupDependencies(strict = false) {
    const env = getAppEnv();
    const issues: string[] = [];

    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
    } catch (error) {
      issues.push(`MongoDB is unreachable for DATABASE_URL: ${this.describeError(error)}`);
    }

    const redis = new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== "PONG") {
        issues.push(`Redis ping returned unexpected response: ${pong}`);
      }
    } catch (error) {
      issues.push(`Redis is unreachable at ${env.REDIS_HOST}:${env.REDIS_PORT}: ${this.describeError(error)}`);
    } finally {
      await redis.quit().catch(() => undefined);
    }

    try {
      const response = await fetch(`${env.TRANSCRIBER_URL}/health`);
      if (!response.ok) {
        issues.push(`Transcriber health check failed at ${env.TRANSCRIBER_URL}/health: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      issues.push(`Transcriber is unreachable at ${env.TRANSCRIBER_URL}: ${this.describeError(error)}`);
    }

    if (issues.length > 0) {
      const message = `API startup checks failed:\n- ${issues.join("\n- ")}`;
      if (strict) {
        throw new ServiceUnavailableException(message);
      }
      this.logger.warn(message);
      return { ok: false, issues };
    }

    return { ok: true, issues: [] as string[] };
  }

  private describeError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
