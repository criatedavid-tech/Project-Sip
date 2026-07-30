import { describe, expect, it } from "vitest";
import { ProviderError } from "@omni/provider-contracts";
import { MockSipProvider } from "./mock-sip.provider";
import { MockWhatsAppProvider } from "./mock-whatsapp.provider";
import { MockTranscriptionProvider } from "./mock-transcription.provider";
import { InMemoryStorageProvider } from "./in-memory-storage.provider";

describe("SipProvider (contrato)", () => {
  it("valida configuração e lista números", async () => {
    const provider = new MockSipProvider();
    await expect(provider.validateConfiguration()).resolves.toMatchObject({ valid: true });
    const numbers = await provider.getNumbers();
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers[0]!.capabilities.outbound).toBe(true);
  });

  it("devolve o correlationId recebido, para correlacionar os eventos assíncronos", async () => {
    const provider = new MockSipProvider();
    const result = await provider.makeCall({
      from: "5511999999999",
      to: "5511888888888",
      correlationId: "corr-1",
    });
    expect(result.correlationId).toBe("corr-1");
    expect(result.externalCallId).toBeTruthy();
  });

  it("sinaliza falha transitória como retryable", async () => {
    const provider = new MockSipProvider({
      failMakeCall: { code: "TRUNK_TIMEOUT", retryable: true },
    });
    await expect(
      provider.makeCall({ from: "5511999999999", to: "5511888888888", correlationId: "c" }),
    ).rejects.toMatchObject({ retryable: true });
  });
});

describe("WhatsAppProvider (contrato)", () => {
  it("é idempotente: mesma idempotencyKey não envia duas vezes", async () => {
    const provider = new MockWhatsAppProvider();
    const request = { to: "5511999999999", body: "oi", idempotencyKey: "msg-1" };

    const first = await provider.sendText(request);
    const second = await provider.sendText(request);

    expect(second.providerMessageId).toBe(first.providerMessageId);
    expect(provider.sent).toHaveLength(1);
  });

  it("verifica o webhook apenas com mode=subscribe e token correto", async () => {
    const provider = new MockWhatsAppProvider({ verifyToken: "segredo" });
    await expect(
      provider.verifyWebhook({ mode: "subscribe", token: "segredo", challenge: "1" }),
    ).resolves.toBe(true);
    await expect(
      provider.verifyWebhook({ mode: "subscribe", token: "errado", challenge: "1" }),
    ).resolves.toBe(false);
  });

  it("normaliza payload desconhecido em lista vazia, sem lançar", async () => {
    const provider = new MockWhatsAppProvider();
    await expect(provider.processWebhook({ foo: "bar" })).resolves.toEqual([]);
  });
});

describe("TranscriptionProvider (contrato)", () => {
  it("retorna texto e segmentos coerentes", async () => {
    const provider = new MockTranscriptionProvider();
    const result = await provider.transcribe({
      audioUrl: "memory://bucket/audio.wav",
      idempotencyKey: "rec-1:mock",
    });
    expect(result.status).toBe("completed");
    expect(result.fullText).toBeTruthy();
    expect(result.segments?.[0]!.endMs).toBeGreaterThan(result.segments![0]!.startMs);
  });

  it("é idempotente por idempotencyKey", async () => {
    const provider = new MockTranscriptionProvider();
    const request = { audioUrl: "memory://b/a.wav", idempotencyKey: "rec-1:mock" };
    const first = await provider.transcribe(request);
    const second = await provider.transcribe(request);
    expect(second.jobId).toBe(first.jobId);
  });

  it("propaga falha como ProviderError", async () => {
    const provider = new MockTranscriptionProvider({
      failTranscribe: { code: "RATE_LIMIT", retryable: true },
    });
    await expect(
      provider.transcribe({ audioUrl: "memory://b/a.wav", idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("StorageProvider (contrato)", () => {
  it("faz upload calculando checksum e devolve URL assinada com expiração", async () => {
    const storage = new InMemoryStorageProvider("gravacoes");
    const body = Buffer.from("audio-falso");

    const stored = await storage.upload({
      objectKey: "calls/abc.wav",
      body,
      contentType: "audio/wav",
    });

    expect(stored.sizeBytes).toBe(body.byteLength);
    expect(stored.checksumSha256).toHaveLength(64);

    const url = await storage.getSignedUrl("calls/abc.wav", 300);
    expect(url).toContain("expires=");
  });

  it("recusa URL assinada para objeto inexistente", async () => {
    const storage = new InMemoryStorageProvider();
    await expect(storage.getSignedUrl("nao-existe", 60)).rejects.toThrow();
  });

  it("remove o objeto no delete", async () => {
    const storage = new InMemoryStorageProvider();
    await storage.upload({
      objectKey: "k",
      body: Buffer.from("x"),
      contentType: "text/plain",
    });
    await storage.delete("k");
    expect(storage.read("k")).toBeUndefined();
  });
});
