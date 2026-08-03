import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@omni/provider-contracts";
import { OpenAiTranscriptionProvider } from "./openai-transcription.provider";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function audioFile() {
  const directory = await mkdtemp(join(tmpdir(), "omni-transcription-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "call.wav");
  await writeFile(file, Buffer.alloc(128, 1));
  return pathToFileURL(file).toString();
}

describe("OpenAiTranscriptionProvider", () => {
  it("envia WAV em multipart e converte segmentos diarizados", async () => {
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(init?.headers).toEqual({ authorization: "Bearer chave-teste" });
      expect(body.get("model")).toBe("gpt-4o-transcribe-diarize");
      expect(body.get("language")).toBe("pt");
      expect(body.get("response_format")).toBe("diarized_json");
      expect(body.get("chunking_strategy")).toBe("auto");
      expect(body.get("file")).toBeInstanceOf(Blob);
        return new Response(
          JSON.stringify({
            text: "Bom dia. Olá.",
            segments: [
              { start: 0, end: 1.2, text: "Bom dia.", speaker: "A" },
              { start: 1.2, end: 2.4, text: "Olá.", speaker: "B" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const provider = new OpenAiTranscriptionProvider({
      apiKey: "chave-teste",
      model: "gpt-4o-transcribe-diarize",
      language: "pt",
      timeoutMs: 5_000,
      fetcher: fetcher as typeof fetch,
    });

    const result = await provider.transcribe({
      audioUrl: await audioFile(),
      idempotencyKey: "recording-1",
      expectedSpeakers: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.fullText).toBe("Bom dia. Olá.");
    expect(result.segments).toEqual([
      {
        index: 0,
        startMs: 0,
        endMs: 1200,
        text: "Bom dia.",
        speakerLabel: "A",
      },
      {
        index: 1,
        startMs: 1200,
        endMs: 2400,
        text: "Olá.",
        speakerLabel: "B",
      },
    ]);
  });

  it("marca limite de requisições como falha retentável", async () => {
    const provider = new OpenAiTranscriptionProvider({
      apiKey: "chave-teste",
      model: "gpt-4o-mini-transcribe",
      language: "pt",
      timeoutMs: 5_000,
      fetcher: vi.fn(async () => new Response(null, { status: 429 })) as typeof fetch,
    });

    const error = await provider
      .transcribe({
        audioUrl: await audioFile(),
        idempotencyKey: "recording-2",
      })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      provider: "openai",
      code: "http_429",
      retryable: true,
    });
  });
});
