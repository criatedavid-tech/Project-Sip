import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { schema, type Database } from "@omni/db";
import { DATABASE } from "../database/database.module";

export interface IngestResult {
  deliveryId: string | null;
  duplicate: boolean;
}

/**
 * Registra a entrega crua antes de qualquer processamento.
 *
 * Roda pela conexão administrativa de propósito: o evento chega antes de
 * sabermos a que organização pertence, então não há tenant para fixar na
 * sessão do RLS. A resolução acontece depois, no processamento.
 */
@Injectable()
export class WebhookIngestService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(params: {
    provider: string;
    payload: unknown;
    signatureValid: boolean;
    eventType?: string;
  }): Promise<IngestResult> {
    const providerEventId = this.deriveEventId(params.payload);

    const rows = await this.db
      .insert(schema.webhookDeliveries)
      .values({
        provider: params.provider,
        providerEventId,
        eventType: params.eventType,
        signatureValid: String(params.signatureValid),
        payload: params.payload as object,
        status: params.signatureValid ? "received" : "rejected",
      })
      // Reentrega é comportamento normal da Meta quando ela não recebe 200
      // rápido; a segunda chegada não pode virar um segundo registro.
      .onConflictDoNothing({
        target: [
          schema.webhookDeliveries.provider,
          schema.webhookDeliveries.providerEventId,
        ],
      })
      .returning({ id: schema.webhookDeliveries.id });

    const inserted = rows[0];
    return { deliveryId: inserted?.id ?? null, duplicate: !inserted };
  }

  async markProcessed(deliveryId: string): Promise<void> {
    await this.db
      .update(schema.webhookDeliveries)
      .set({ status: "processed", processedAt: new Date() })
      .where(sql`id = ${deliveryId}`);
  }

  async markFailed(deliveryId: string, errorMessage: string): Promise<void> {
    await this.db
      .update(schema.webhookDeliveries)
      .set({ status: "failed", errorMessage: errorMessage.slice(0, 1000) })
      .where(sql`id = ${deliveryId}`);
  }

  /**
   * A Meta não envia um id de entrega. Usamos o hash do corpo: reentrega do
   * mesmo evento produz o mesmo hash e é deduplicada, enquanto um evento
   * genuinamente novo produz outro.
   */
  private deriveEventId(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }
}
