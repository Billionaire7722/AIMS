import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DependencyChecksService } from "../../runtime/dependency-checks.service.js";

@Controller()
export class HealthController {
  constructor(private readonly checks: DependencyChecksService) {}

  @Get("health")
  health() {
    return { ok: true, service: "api", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async ready() {
    const result = await this.checks.checkStartupDependencies(false);
    if (!result.ok) {
      throw new ServiceUnavailableException(result.issues.join("; "));
    }
    return result;
  }
}
