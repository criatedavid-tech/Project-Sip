import { createHash } from "node:crypto";
import type {
  StorageProvider,
  StoredObject,
  UploadRequest,
} from "@omni/provider-contracts";

interface StoredEntry {
  body: Buffer;
  contentType: string;
  storedAt: Date;
  checksumSha256: string;
}

export class InMemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, StoredEntry>();

  constructor(private readonly bucket = "mock-bucket") {}

  async upload(request: UploadRequest): Promise<StoredObject> {
    const body = Buffer.isBuffer(request.body)
      ? request.body
      : await streamToBuffer(request.body);
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    const storedAt = new Date();
    this.objects.set(request.objectKey, {
      body,
      contentType: request.contentType,
      storedAt,
      checksumSha256,
    });
    return {
      objectKey: request.objectKey,
      bucket: this.bucket,
      sizeBytes: body.byteLength,
      checksumSha256,
      storedAt,
    };
  }

  async getSignedUrl(objectKey: string, expiresIn: number): Promise<string> {
    if (!this.objects.has(objectKey)) {
      throw new Error(`objeto inexistente: ${objectKey}`);
    }
    const expiresAt = Date.now() + expiresIn * 1000;
    return `memory://${this.bucket}/${objectKey}?expires=${expiresAt}`;
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  read(objectKey: string): Buffer | undefined {
    return this.objects.get(objectKey)?.body;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
