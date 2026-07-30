import { Module } from "@nestjs/common";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "@omni/provider-contracts";
import { MockWhatsAppProvider } from "@omni/testing";
import { loadEnv } from "@omni/config";
import { MetaCloudApiProvider } from "./meta-cloud.provider";
import { WhatsappWebhookController } from "./webhook.controller";
import { WebhookIngestService } from "./webhook-ingest.service";
import { InboundMessageService } from "./inbound-message.service";

/**
 * O driver começa em "mock" por padrão: assim nenhum ambiente envia mensagem
 * real por acidente de configuração — é preciso pedir "real" explicitamente.
 */
const providerFactory = {
  provide: WHATSAPP_PROVIDER,
  useFactory: (): WhatsAppProvider => {
    const env = loadEnv();

    if (env.WHATSAPP_PROVIDER_DRIVER !== "real") {
      return new MockWhatsAppProvider({
        verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "mock-verify-token",
      });
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    const appSecret = process.env.META_APP_SECRET;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const webhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (!accessToken || !appSecret || !phoneNumberId || !webhookVerifyToken) {
      throw new Error(
        "WHATSAPP_PROVIDER_DRIVER=real exige META_ACCESS_TOKEN, META_APP_SECRET, " +
          "META_PHONE_NUMBER_ID e META_WEBHOOK_VERIFY_TOKEN",
      );
    }

    return new MetaCloudApiProvider({
      accessToken,
      appSecret,
      phoneNumberId,
      webhookVerifyToken,
      graphApiVersion: process.env.META_GRAPH_API_VERSION,
    });
  },
};

@Module({
  controllers: [WhatsappWebhookController],
  providers: [providerFactory, WebhookIngestService, InboundMessageService],
  exports: [providerFactory, InboundMessageService],
})
export class WhatsappModule {}
