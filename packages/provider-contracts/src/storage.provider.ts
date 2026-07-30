export interface UploadRequest {
  objectKey: string;
  body: Buffer | NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
  checksumSha256?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  objectKey: string;
  bucket: string;
  sizeBytes: number;
  checksumSha256?: string;
  storedAt: Date;
}

export const STORAGE_PROVIDER = Symbol("StorageProvider");

export interface StorageProvider {
  upload(request: UploadRequest): Promise<StoredObject>;
  getSignedUrl(objectKey: string, expiresIn: number): Promise<string>;
  delete(objectKey: string): Promise<void>;
}
