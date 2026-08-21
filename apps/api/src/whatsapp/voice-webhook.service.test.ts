import { describe, expect, it } from "vitest";
import {
  accountNumberForEvent,
  deviceConnectionFromEvent,
  normalizeVoiceNumber,
  validVoiceWebhookToken,
  voiceWebhookEventSchema,
} from "./voice-webhook.service";

const outgoingCall = voiceWebhookEventSchema.parse({
  event: "call.updated",
  type: "CALL",
  action: "UPDATE",
  id: "call-1",
  id_session: 42,
  caller: "5511999999999",
  receiver: "5511888888888",
  status: "ENDED",
  direction: "OUTCOMING",
  duration: 37,
});

describe("eventos de voz pelo WhatsApp", () => {
  it("aceita campos adicionais e preserva duração real", () => {
    expect(outgoingCall.duration).toBe(37);
    expect(outgoingCall.id).toBe("call-1");
  });

  it("identifica o número da conta de acordo com a direção", () => {
    expect(accountNumberForEvent(outgoingCall)).toBe("5511999999999");
    expect(
      accountNumberForEvent(
        voiceWebhookEventSchema.parse({
          ...outgoingCall,
          direction: "INCOMING",
        }),
      ),
    ).toBe("5511888888888");
    expect(normalizeVoiceNumber("+55 (11) 99999-9999")).toBe("5511999999999");
  });

  it("não confunde restrição temporária com desconexão", () => {
    const restriction = voiceWebhookEventSchema.parse({
      event: "device.timelock_updated",
      type: "DEVICE",
      action: "UPDATE",
      id_session: 42,
      timelock_type: "DEFAULT",
      timelock_expiration: "2026-08-22T00:00:00.000Z",
    });
    const opened = voiceWebhookEventSchema.parse({
      event: "device.opened",
      type: "DEVICE",
      action: "UPDATE",
      id_session: 42,
      status: "open",
    });

    expect(deviceConnectionFromEvent(restriction)).toBeNull();
    expect(deviceConnectionFromEvent(opened)).toBe(true);
  });

  it("exige token longo e faz comparação exata", () => {
    const token = "a".repeat(48);
    expect(validVoiceWebhookToken(token, token)).toBe(true);
    expect(validVoiceWebhookToken(`${token}b`, token)).toBe(false);
    expect(validVoiceWebhookToken("curto", "curto")).toBe(false);
  });
});
