import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return { status: "ok" };
  }
}
