import { Controller, Get, Inject } from "@nestjs/common";
import { PERMISSIONS } from "@omni/auth";
import { CurrentUser, type AuthenticatedUser } from "../auth/current-user";
import { RequirePermissions } from "../auth/permissions.guard";
import { VoiceWebhookService } from "./voice-webhook.service";

@Controller("whatsapp/voice")
export class VoiceChannelController {
  constructor(
    @Inject(VoiceWebhookService) private readonly voice: VoiceWebhookService,
  ) {}

  @RequirePermissions(PERMISSIONS.callsRead)
  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.voice.status(user.organizationId);
  }
}
