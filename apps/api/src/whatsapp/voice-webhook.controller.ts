import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { createLogger } from "@omni/observability";
import { Public } from "../auth/auth.guard";
import { WebhookIngestService } from "./webhook-ingest.service";
import {
  validVoiceWebhookToken,
  VoiceWebhookService,
  voiceWebhookEventSchema,
} from "./voice-webhook.service";

const logger = createLogger({ service: "whatsapp-voice-webhook" });
const PROVIDER_KEY = "whatsapp_voice";

@Controller("webhooks/whatsapp/voice")
export class VoiceWebhookController {
  constructor(
    @Inject(WebhookIngestService)
    private readonly ingest: WebhookIngestService,
    @Inject(VoiceWebhookService)
    private readonly voice: VoiceWebhookService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: Request,
    @Query("token") queryToken?: string,
    @Headers("x-webhook-token") headerToken?: string,
    @Headers("x-wavoip-delivery-id") providerDeliveryId?: string,
  ): Promise<{ received: true }> {
    const tokenValid = validVoiceWebhookToken(headerToken ?? queryToken);
    const parsed = voiceWebhookEventSchema.safeParse(request.body);
    const delivery = await this.ingest.record({
      provider: tokenValid ? PROVIDER_KEY : `${PROVIDER_KEY}_rejected`,
      providerEventId: providerDeliveryId,
      payload: request.body,
      signatureValid: tokenValid,
      eventType: parsed.success ? parsed.data.event : undefined,
    });

    if (!tokenValid) {
      logger.warn("evento de voz pelo WhatsApp recusado: token inválido");
      return { received: true };
    }
    if (delivery.duplicate || !delivery.deliveryId) {
      logger.info("evento de voz pelo WhatsApp duplicado ignorado");
      return { received: true };
    }
    if (!parsed.success) {
      await this.ingest.markFailed(delivery.deliveryId, "payload inválido");
      logger.warn("evento de voz pelo WhatsApp com payload inválido");
      return { received: true };
    }

    try {
      const organizationId = await this.voice.resolveOrganization(parsed.data);
      if (!organizationId) {
        await this.ingest.markFailed(
          delivery.deliveryId,
          "conta de voz sem organização",
        );
        logger.warn(
          { sessionId: parsed.data.id_session },
          "evento de voz sem organização cadastrada",
        );
        return { received: true };
      }

      await this.ingest.assignOrganization(delivery.deliveryId, organizationId);
      await this.ingest.markProcessed(delivery.deliveryId);
      logger.info(
        {
          organizationId,
          event: parsed.data.event,
          sessionId: parsed.data.id_session,
          callId: parsed.data.whatsapp_call_id ?? parsed.data.id,
        },
        "evento de voz pelo WhatsApp recebido",
      );
    } catch (error) {
      logger.error({ err: error }, "falha ao processar evento de voz pelo WhatsApp");
      await this.ingest.markFailed(
        delivery.deliveryId,
        error instanceof Error ? error.message : String(error),
      );
    }

    return { received: true };
  }
}
