import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@omni/db";
import type { Logger } from "@omni/observability";
import type { RecordingLifecycleEvent } from "./ari-monitor";

const SAFE_RECORDING_ID = /^[A-Za-z0-9._-]+$/;

export interface AvailableRecording {
  organizationId: string;
  recordingId: string;
  storageKey: string;
}

export function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const milliseconds = Number.parseInt(value, 10);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return Math.ceil(milliseconds / 1_000);
}

export function eventTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const milliseconds = Number.parseInt(value, 10);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function callStatus(
  dialStatus: string | undefined,
  callDurationSeconds?: number | null,
): string {
  if (callDurationSeconds && callDurationSeconds > 0) return "completed";
  switch (dialStatus?.toUpperCase()) {
    case "ANSWER":
      return "completed";
    case "BUSY":
      return "busy";
    case "NOANSWER":
      return "no_answer";
    case "CANCEL":
      return "cancelled";
    case "TIMEOUT":
    case "JOINEMPTY":
    case "LEAVEEMPTY":
    case "JOINUNAVAIL":
    case "LEAVEUNAVAIL":
      return "no_answer";
    default:
      return "failed";
  }
}

export function recordingStatus(
  normalizedCallStatus: string,
  fileAvailable: boolean,
): "available" | "failed" | "not_recorded" {
  if (normalizedCallStatus !== "completed") return "not_recorded";
  return fileAvailable ? "available" : "failed";
}

export class CallEventStore {
  private readonly recordingsRoot: string;

  constructor(
    private readonly db: Database,
    recordingsPath: string,
    private readonly logger: Logger,
  ) {
    this.recordingsRoot = resolve(recordingsPath);
  }

  async handle(event: RecordingLifecycleEvent): Promise<AvailableRecording | null> {
    if (!event.recordingId || !event.callId) {
      this.logger.warn(
        {
          recordingId: event.recordingId,
          callId: event.callId,
          direction: event.direction,
        },
        "evento de chamada incompleto ignorado",
      );
      return null;
    }
    if (!SAFE_RECORDING_ID.test(event.recordingId)) {
      this.logger.warn({ recordingId: event.recordingId }, "id de gravação inválido");
      return null;
    }

    const [extension] = event.extension
      ? await this.db
          .select({
            id: schema.telephonyExtensions.id,
            organizationId: schema.telephonyExtensions.organizationId,
            userId: schema.telephonyExtensions.userId,
          })
          .from(schema.telephonyExtensions)
          .where(eq(schema.telephonyExtensions.endpointId, event.extension))
          .limit(1)
      : [];
    const [tenantFallback] = extension
      ? []
      : await this.db
          .select({ organizationId: schema.telephonyExtensions.organizationId })
          .from(schema.telephonyExtensions)
          .where(eq(schema.telephonyExtensions.status, "active"))
          .limit(1);
    const callOwner =
      extension ??
      (tenantFallback
        ? { id: null, organizationId: tenantFallback.organizationId, userId: null }
        : null);

    if (!callOwner) {
      this.logger.warn(
        { extension: event.extension, callId: event.callId },
        "não foi possível identificar a organização da chamada",
      );
      return null;
    }

    const endedAt = eventTimestamp(event.endedAtMs) ?? new Date();
    const seconds = durationSeconds(event.durationMs);
    const fallbackStart = new Date(
      endedAt.getTime() - (seconds === null ? 0 : seconds * 1_000),
    );
    const startedAt = eventTimestamp(event.startedAtMs) ?? fallbackStart;
    const callId = await this.ensureCall(
      event,
      callOwner,
      startedAt,
    );

    if (event.stage === "started") {
      await this.ensureRecording(
        callOwner.organizationId,
        callId,
        event.recordingId,
      );
      return null;
    }

    const status = callStatus(event.dialStatus, seconds);
    await this.db
      .update(schema.voiceCalls)
      .set({
        status,
        answeredAt:
          status === "completed" && seconds !== null
            ? eventTimestamp(event.answeredAtMs) ??
              new Date(endedAt.getTime() - seconds * 1_000)
            : null,
        endedAt,
        durationSeconds: seconds,
        hangupCause: event.dialStatus ?? null,
        updatedAt: endedAt,
      })
      .where(eq(schema.voiceCalls.id, callId));

    const databaseRecordingId = await this.ensureRecording(
      callOwner.organizationId,
      callId,
      event.recordingId,
    );
    const recordingFile = this.recordingFile(event.recordingId);
    const file = await stat(recordingFile).catch(() => null);
    const available = Boolean(file?.isFile() && file.size > 44);
    const normalizedRecordingStatus = recordingStatus(status, available);

    await this.db
      .update(schema.callRecordings)
      .set({
        status: normalizedRecordingStatus,
        sizeBytes: file?.size ?? null,
        durationSeconds: seconds,
        availableAt: available ? endedAt : null,
        updatedAt: endedAt,
      })
      .where(
        and(
          eq(schema.callRecordings.organizationId, callOwner.organizationId),
          eq(schema.callRecordings.storageKey, event.recordingId),
        ),
      );

    this.logger.info(
      {
        callId: event.callId,
        recordingId: event.recordingId,
        status,
        recordingAvailable: available,
        recordingStatus: normalizedRecordingStatus,
      },
      "chamada e gravação persistidas",
    );

    return available
      ? {
          organizationId: callOwner.organizationId,
          recordingId: databaseRecordingId,
          storageKey: event.recordingId,
        }
      : null;
  }

  private async ensureCall(
    event: RecordingLifecycleEvent,
    extension: {
      id: string | null;
      organizationId: string;
      userId: string | null;
    },
    startedAt: Date,
  ): Promise<string> {
    const [inserted] = await this.db
      .insert(schema.voiceCalls)
      .values({
        organizationId: extension.organizationId,
        externalCallId: event.callId!,
        linkedId: event.linkedId ?? null,
        direction: event.direction ?? "unknown",
        provider: event.provider ?? "unknown",
        fromNumber: event.fromNumber ?? null,
        toNumber: event.toNumber ?? null,
        status: "ringing",
        userId: extension.userId,
        extensionId: extension.id,
        startedAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.voiceCalls.id });

    if (inserted) return inserted.id;

    const [existing] = await this.db
      .select({ id: schema.voiceCalls.id })
      .from(schema.voiceCalls)
      .where(
        and(
          eq(schema.voiceCalls.organizationId, extension.organizationId),
          eq(schema.voiceCalls.externalCallId, event.callId!),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("não foi possível localizar a chamada persistida");
    return existing.id;
  }

  private async ensureRecording(
    organizationId: string,
    callId: string,
    recordingId: string,
  ): Promise<string> {
    const [inserted] = await this.db
      .insert(schema.callRecordings)
      .values({
        organizationId,
        callId,
        storageKey: recordingId,
        fileName: `${recordingId}.wav`,
      })
      .onConflictDoNothing()
      .returning({ id: schema.callRecordings.id });
    if (inserted) return inserted.id;

    const [existing] = await this.db
      .select({ id: schema.callRecordings.id })
      .from(schema.callRecordings)
      .where(
        and(
          eq(schema.callRecordings.organizationId, organizationId),
          eq(schema.callRecordings.storageKey, recordingId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("não foi possível localizar a gravação persistida");
    return existing.id;
  }

  private recordingFile(recordingId: string): string {
    const file = resolve(this.recordingsRoot, `${recordingId}.wav`);
    if (!file.startsWith(`${this.recordingsRoot}${sep}`)) {
      throw new Error("caminho de gravação inválido");
    }
    return file;
  }
}
