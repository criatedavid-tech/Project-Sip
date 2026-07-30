import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "@omni/provider-contracts";
import { createLogger } from "@omni/observability";
import { Public } from "../auth/auth.guard";
import { MetaCloudApiProvider } from "./meta-cloud.provider";
import { WebhookIngestService } from "./webhook-ingest.service";
import { InboundMessageService } from "./inbound-message.service";
import { metaWebhookSchema } from "./meta-payloads";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const logger = createLogger({ service: "whatsapp-webhook" });

@Controller("webhooks/whatsapp")
export class WhatsappWebhookController {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly ingest: WebhookIngestService,
    private readonly inbound: InboundMessageService,
  ) {}

  /** Handshake da Meta ao cadastrar a URL do webhook. */
  @Public()
  @Get()
  @Header("content-type", "text/plain")
  async verify(
    @Query("hub.mode") mode = "",
    @Query("hub.verify_token") token = "",
    @Query("hub.challenge") challenge = "",
  ): Promise<string> {
    const valid = await this.provider.verifyWebhook({ mode, token, challenge });
    if (!valid) {
      logger.warn("tentativa de verificação de webhook com token inválido");
      // A Meta espera o desafio de volta; qualquer outra resposta reprova a URL.
      return "";
    }
    return challenge;
  }

  /**
   * Responde 200 o mais cedo possível: a Meta exige resposta em poucos segundos
   * e reenvia (ou desativa a assinatura) quando o endpoint demora.
   *
   * Sempre 200, inclusive para assinatura inválida — devolver erro faria a Meta
   * reenviar indefinidamente um payload que nunca será aceito. A rejeição fica
   * registrada em webhook_deliveries.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RawBodyRequest): Promise<{ received: true }> {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers["x-hub-signature-256"];

    const signatureValid =
      this.provider instanceof MetaCloudApiProvider
        ? this.provider.verifySignature(
            rawBody,
            typeof signature === "string" ? signature : undefined,
          )
        : true;

    const delivery = await this.ingest.record({
      provider: "meta_cloud_api",
      payload: request.body,
      signatureValid,
    });

    if (!signatureValid) {
      logger.warn("webhook recusado: assinatura inválida");
      return { received: true };
    }

    if (delivery.duplicate) {
      logger.info("webhook duplicado ignorado");
      return { received: true };
    }

    // Processamento inline por enquanto. O enfileiramento entra junto com o
    // worker de mídia, quando houver download a fazer.
    if (delivery.deliveryId) {
      await this.process(delivery.deliveryId, request.body);
    }

    return { received: true };
  }

  private async process(deliveryId: string, payload: unknown): Promise<void> {
    try {
      const parsed = metaWebhookSchema.safeParse(payload);
      const phoneNumberId = parsed.success
        ? parsed.data.entry[0]?.changes[0]?.value.metadata?.phone_number_id
        : undefined;

      if (!phoneNumberId) {
        await this.ingest.markProcessed(deliveryId);
        return;
      }

      const account = await this.inbound.resolveOrganization(phoneNumberId);
      if (!account) {
        // Número não cadastrado: registrar e seguir. Não é falha nossa, e
        // retentar não mudaria o resultado.
        logger.warn({ phoneNumberId }, "webhook para número não cadastrado");
        await this.ingest.markFailed(deliveryId, "phone_number_id sem organização");
        return;
      }

      const events = await this.provider.processWebhook(payload);
      const result = await this.inbound.apply(
        account.organizationId,
        account.whatsappAccountId,
        events,
      );

      logger.info(
        { organizationId: account.organizationId, ...result },
        "webhook processado",
      );
      await this.ingest.markProcessed(deliveryId);
    } catch (error) {
      logger.error({ err: error }, "falha ao processar webhook");
      await this.ingest.markFailed(
        deliveryId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
