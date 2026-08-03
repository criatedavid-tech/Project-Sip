import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@omni/provider-contracts";
import { LocalWhisperTranscriptionProvider } from "./local-whisper-transcription.provider";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function audioFile() {
  const directory = await mkdtemp(join(tmpdir(), "omni-whisper-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "call.wav");
  await writeFile(file, Buffer.alloc(128, 1));
  return pathToFileURL(file).toString();
}

describe("LocalWhisperTranscriptionProvider", () => {
  it("envia o WAV ao serviço local e converte os segmentos", async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const body = init?.body as FormData;
        expect(body.get("language")).toBe("pt");
        expect(body.get("idempotency_key")).toBe("recording-1");
        expect(body.get("file")).toBeInstanceOf(Blob);
        return new Response(
          JSON.stringify({
            text: "Bom dia. Como posso ajudar?",
            language: "pt",
            model: "small",
            version: "1.2.1",
            segments: [
              { start: 0, end: 1.25, text: "Bom dia.", confidence: 0.91 },
              { start: 1.25, end: 2.8, text: "Como posso ajudar?" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const provider = new LocalWhisperTranscriptionProvider({
      endpoint: "http://127.0.0.1:8090/v1/transcriptions",
      model: "small",
      language: "pt",
      timeoutMs: 5_000,
      fetcher: fetcher as typeof fetch,
    });

    const result = await provider.transcribe({
      audioUrl: await audioFile(),
      idempotencyKey: "recording-1",
    });

    expect(result).toMatchObject({
      status: "completed",
      fullText: "Bom dia. Como posso ajudar?",
      language: "pt",
      model: "small",
      providerVersion: "1.2.1",
    });
    expect(result.segments).toEqual([
      {
        index: 0,
        startMs: 0,
        endMs: 1_250,
        text: "Bom dia.",
        confidence: 0.91,
      },
      {
        index: 1,
        startMs: 1_250,
        endMs: 2_800,
        text: "Como posso ajudar?",
      },
    ]);
  });

  it("marca indisponibilidade do serviço local como retentável", async () => {
    const provider = new LocalWhisperTranscriptionProvider({
      endpoint: "http://127.0.0.1:8090/v1/transcriptions",
      model: "small",
      language: "pt",
      timeoutMs: 5_000,
      fetcher: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
    });

    const error = await provider
      .transcribe({
        audioUrl: await audioFile(),
        idempotencyKey: "recording-2",
      })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      provider: "whisper_local",
      code: "http_503",
      retryable: true,
    });
  });
});
