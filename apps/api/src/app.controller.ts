import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database } from "@omni/db";
import { DATABASE } from "./database/database.module";
import { Public } from "./auth/auth.guard";

@Controller()
export class AppController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: só diz que o processo respondeu. */
  @Public()
  @Get("health")
  health() {
    return { status: "ok" };
  }

  /** Readiness: só entra no balanceador se as dependências responderem. */
  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable", database: "down" });
    }
    return { status: "ok", database: "up" };
  }
}
