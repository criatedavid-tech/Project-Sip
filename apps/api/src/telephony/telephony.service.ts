import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, sep } from "node:path";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { hashPassword, ROLES } from "@omni/auth";
import { loadTelephonyEnv } from "@omni/config";
import { schema, withOrganization, type Database } from "@omni/db";
import type { AuthenticatedUser } from "../auth/current-user";
import { DATABASE } from "../database/database.module";

const ariSystemSchema = z.object({
  system: z.object({ version: z.string() }),
});

const ariEndpointSchema = z.object({
  technology: z.string(),
  resource: z.string(),
  state: z.string(),
  channel_ids: z.array(z.string()).default([]),
});

const ariChannelsSchema = z.array(z.object({ id: z.string() }));
const safeRecordingId = /^[A-Za-z0-9._-]+$/;
const telephonyFiltersSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().uuid().optional(),
  provider: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  status: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
});
const dashboardFiltersSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["inbound", "outbound"]).optional(),
  userId: z.string().uuid().optional(),
  provider: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  status: z.string().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  granularity: z.enum(["hour", "day", "week", "month"]).default("day"),
});
const createCollaboratorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
  roleKey: z.enum([ROLES.agent, ROLES.supervisor]).default(ROLES.agent),
  extension: z.string().regex(/^\d{4}$/).optional(),
});
const collaboratorStatusSchema = z.object({ active: z.boolean() });
const createDialerContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phoneNumber: z.string().trim().min(10).max(30),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2_000).optional(),
});
const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  provider: z.enum(["directcall", "wavoip", "twilio"]).default("twilio"),
  contactIds: z.array(z.string().uuid()).min(1).max(5_000),
});
const campaignStatusSchema = z.object({
  status: z.enum(["draft", "active", "paused", "completed"]),
});
const campaignItemResultSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]),
  disposition: z.enum([
    "answered",
    "no_answer",
    "busy",
    "invalid",
    "callback",
    "sale",
    "not_interested",
  ]),
  notes: z.string().trim().max(2_000).optional(),
});

export function normalizeDialerPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits) ? digits : null;
}

export interface TelephonyFilters {
  date?: string;
  userId?: string;
  provider?: string;
  status?: string;
  direction?: "inbound" | "outbound";
}

interface ParsedTelephonyFilters extends TelephonyFilters {
  start?: Date;
  end?: Date;
  recordingStatus?: string;
}

export interface DashboardCallMetricInput {
  status: string;
  direction: string;
  startedAt: Date | string;
  durationSeconds: number | null;
  answerTimeSeconds: number | null;
  wrapUpTimeSeconds: number | null;
}

export type DashboardGranularity = "hour" | "day" | "week" | "month";

export function callTiming(input: {
  startedAt: Date | string;
  answeredAt: Date | string | null;
}) {
  if (!input.answeredAt) {
    return { answerTimeSeconds: null, wrapUpTimeSeconds: null };
  }
  const startedAt = new Date(input.startedAt).getTime();
  const answeredAt = new Date(input.answeredAt).getTime();
  return {
    answerTimeSeconds:
      Number.isFinite(startedAt) && Number.isFinite(answeredAt)
        ? Math.max(0, Math.round((answeredAt - startedAt) / 1_000))
        : null,
    // O banco ainda não registra o instante de fim do pós-atendimento.
    wrapUpTimeSeconds: null,
  };
}

export function buildDashboardMetrics(calls: DashboardCallMetricInput[]) {
  const durations = calls.flatMap((call) =>
    call.durationSeconds === null ? [] : [call.durationSeconds],
  );
  const handleTimes = calls.flatMap((call) =>
    call.durationSeconds === null || call.wrapUpTimeSeconds === null
      ? []
      : [call.durationSeconds + call.wrapUpTimeSeconds],
  );
  const totalConversationSeconds = durations.reduce(
    (total, duration) => total + duration,
    0,
  );
  return {
    averageHandleTimeSeconds:
      handleTimes.length === 0
        ? null
        : Math.round(
            handleTimes.reduce((total, duration) => total + duration, 0) /
              handleTimes.length,
          ),
    totalCalls: calls.length,
    totalConversationSeconds,
    averageConversationSeconds:
      durations.length === 0
        ? null
        : Math.round(totalConversationSeconds / durations.length),
    completedCalls: calls.filter((call) => call.status === "completed").length,
    failedCalls: calls.filter((call) =>
      ["failed", "busy", "no_answer", "cancelled"].includes(call.status),
    ).length,
  };
}

const saoPauloParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function dashboardBucket(
  value: Date | string,
  granularity: DashboardGranularity,
) {
  const parts = Object.fromEntries(
    saoPauloParts
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (granularity === "hour") {
    return { key: `${day}T${parts.hour}`, label: `${parts.hour}h` };
  }
  if (granularity === "day") {
    return { key: day, label: `${parts.day}/${parts.month}` };
  }
  if (granularity === "month") {
    return { key: `${parts.year}-${parts.month}`, label: `${parts.month}/${parts.year}` };
  }
  const date = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  const weekYear = date.getUTCFullYear();
  const weekMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const weekDay = String(date.getUTCDate()).padStart(2, "0");
  return {
    key: `${weekYear}-${weekMonth}-${weekDay}`,
    label: `Sem. ${weekDay}/${weekMonth}`,
  };
}

export function buildDashboardSeries(
  calls: DashboardCallMetricInput[],
  granularity: DashboardGranularity,
) {
  const buckets = new Map<
    string,
    { key: string; label: string; inbound: number; outbound: number; total: number }
  >();
  for (const call of calls) {
    const bucket = dashboardBucket(call.startedAt, granularity);
    const current = buckets.get(bucket.key) ?? {
      ...bucket,
      inbound: 0,
      outbound: 0,
      total: 0,
    };
    current.total += 1;
    if (call.direction === "inbound") current.inbound += 1;
    if (call.direction === "outbound") current.outbound += 1;
    buckets.set(bucket.key, current);
  }
  return [...buckets.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function parseDashboardFilters(input: Record<string, unknown>) {
  const parsed = dashboardFiltersSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException("filtros do dashboard inválidos");
  }
  const start = new Date(`${parsed.data.startDate}T00:00:00-03:00`);
  const endInclusive = new Date(`${parsed.data.endDate}T00:00:00-03:00`);
  const end = new Date(endInclusive.getTime() + 24 * 60 * 60 * 1_000);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(endInclusive.getTime()) ||
    start > endInclusive ||
    end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
  ) {
    throw new BadRequestException("período do dashboard inválido");
  }
  const normalizedStart = saoPauloParts.format(start).slice(0, 10);
  const normalizedEnd = saoPauloParts.format(endInclusive).slice(0, 10);
  if (
    normalizedStart !== parsed.data.startDate ||
    normalizedEnd !== parsed.data.endDate
  ) {
    throw new BadRequestException("período do dashboard inválido");
  }
  return { ...parsed.data, start, end };
}

export function scopedTelephonyUserId(
  user: Pick<AuthenticatedUser, "userId" | "roleKey">,
  requestedUserId?: string,
): string | undefined {
  return user.roleKey === ROLES.agent ? user.userId : requestedUserId;
}

export function saoPauloDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseTelephonyFilters(
  input: Record<string, unknown>,
): ParsedTelephonyFilters {
  const parsed = telephonyFiltersSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException("filtros de telefonia inválidos");
  }

  if (!parsed.data.date) return parsed.data;
  const start = new Date(`${parsed.data.date}T00:00:00-03:00`);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException("data inválida");
  }
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  if (normalized !== parsed.data.date) {
    throw new BadRequestException("data inválida");
  }

  return {
    ...parsed.data,
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1_000),
  };
}

export function webRtcPassword(
  endpointId: string,
  env: {
    ASTERISK_WEBRTC_1001_PASSWORD: string;
    ASTERISK_WEBRTC_1002_PASSWORD: string;
    ASTERISK_WEBRTC_SECRET?: string;
    ASTERISK_EXTENSION_START: number;
    ASTERISK_EXTENSION_END: number;
  },
): string | undefined {
  if (endpointId === "1001") return env.ASTERISK_WEBRTC_1001_PASSWORD;
  if (endpointId === "1002") return env.ASTERISK_WEBRTC_1002_PASSWORD;
  const numeric = Number.parseInt(endpointId, 10);
  if (
    !/^\d{4}$/.test(endpointId) ||
    numeric < env.ASTERISK_EXTENSION_START ||
    numeric > env.ASTERISK_EXTENSION_END
  ) {
    return undefined;
  }

  const secret =
    env.ASTERISK_WEBRTC_SECRET ??
    `${env.ASTERISK_WEBRTC_1001_PASSWORD}:${env.ASTERISK_WEBRTC_1002_PASSWORD}`;
  return createHmac("sha256", secret)
    .update(`omni-webrtc:${endpointId}`)
    .digest("base64url");
}

export interface AsteriskSnapshot {
  available: boolean;
  version: string | null;
  trunk: {
    endpoint: string;
    status: "online" | "offline" | "unknown";
  };
  trunks: Array<{
    endpoint: string;
    label: string;
    status: "online" | "offline" | "unknown";
  }>;
  endpointStates: Record<string, string>;
  activeChannels: number;
  activeCalls: number;
}

export function summarizeAri(input: {
  info: unknown;
  endpoints: unknown;
  channels: unknown;
}): AsteriskSnapshot {
  const info = ariSystemSchema.parse(input.info);
  const endpoints = z.array(ariEndpointSchema).parse(input.endpoints);
  const channels = ariChannelsSchema.parse(input.channels);
  const endpointStates = Object.fromEntries(
    endpoints.map((endpoint) => [endpoint.resource, endpoint.state]),
  );
  const trunkStatus = (endpoint: string) => {
    const state = endpointStates[endpoint];
    return state === "online" || state === "offline" ? state : "unknown";
  };
  const directcallStatus = trunkStatus("directcall");
  const wavoipStatus = trunkStatus("wavoip");
  const twilioStatus = trunkStatus("twilio");

  return {
    available: true,
    version: info.system.version,
    trunk: {
      endpoint: "directcall",
      status: directcallStatus,
    },
    trunks: [
      { endpoint: "directcall", label: "DirectCall", status: directcallStatus },
      { endpoint: "wavoip", label: "WhatsApp", status: wavoipStatus },
      { endpoint: "twilio", label: "Twilio", status: twilioStatus },
    ],
    endpointStates,
    activeChannels: channels.length,
    // Uma chamada normal possui dois canais. Durante toque pode haver apenas um.
    activeCalls: channels.length === 0 ? 0 : Math.ceil(channels.length / 2),
  };
}

@Injectable()
export class TelephonyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async overview(user: AuthenticatedUser) {
    const [database, asterisk] = await Promise.all([
      this.databaseSnapshot(user, {}, 50),
      this.asteriskSnapshot(),
    ]);

    const team = database.team.map((member) => ({
      ...member,
      endpointStatus: member.endpointId
        ? (asterisk.endpointStates[member.endpointId] ?? "unknown")
        : "unassigned",
    }));

    const ownActiveCalls = database.calls.filter((call) =>
      ["ringing", "answered"].includes(call.status),
    ).length;
    const visibleAsterisk =
      user.roleKey === ROLES.agent
        ? {
            ...asterisk,
            endpointStates: Object.fromEntries(
              team.flatMap((member) =>
                member.endpointId
                  ? [[member.endpointId, member.endpointStatus]]
                  : [],
              ),
            ),
            activeChannels: ownActiveCalls === 0 ? 0 : ownActiveCalls * 2,
            activeCalls: ownActiveCalls,
          }
        : asterisk;

    return {
      generatedAt: new Date(),
      scope: user.roleKey === ROLES.agent ? "own" : "organization",
      asterisk: visibleAsterisk,
      summary: {
        activeCalls: visibleAsterisk.activeCalls,
        onlineExtensions: team.filter((member) => member.endpointStatus === "online")
          .length,
        teamMembers: team.length,
        calls: database.calls.length,
        recordings: database.recordings.length,
        transcriptions: database.recordings.filter(
          (recording) => recording.transcription?.status === "completed",
        ).length,
      },
      team,
      calls: database.calls,
      recordings: database.recordings,
    };
  }

  async calls(user: AuthenticatedUser, input: Record<string, unknown>) {
    const filters = parseTelephonyFilters(input);
    const database = await this.databaseSnapshot(user, filters, 500);
    return {
      scope: user.roleKey === ROLES.agent ? "own" : "organization",
      filters: {
        date: filters.date ?? null,
        userId: scopedTelephonyUserId(user, filters.userId) ?? null,
        provider: filters.provider ?? null,
        status: filters.status ?? null,
        direction: filters.direction ?? null,
      },
      items: database.calls,
    };
  }

  async recordings(user: AuthenticatedUser, input: Record<string, unknown>) {
    const filters = parseTelephonyFilters(input);
    const database = await this.databaseSnapshot(
      user,
      { ...filters, status: undefined, recordingStatus: filters.status },
      500,
    );
    return {
      scope: user.roleKey === ROLES.agent ? "own" : "organization",
      filters: {
        date: filters.date ?? null,
        userId: scopedTelephonyUserId(user, filters.userId) ?? null,
        provider: filters.provider ?? null,
        status: filters.status ?? null,
        direction: filters.direction ?? null,
      },
      items: database.recordings,
    };
  }

  async dailyAdmin(user: AuthenticatedUser, input: Record<string, unknown>) {
    const filters = parseTelephonyFilters({
      ...input,
      date: input.date ?? saoPauloDate(),
    });
    const database = await this.databaseSnapshot(user, filters, 5_000);
    const recordingsByUser = new Map<string, typeof database.recordings>();
    for (const recording of database.recordings) {
      if (!recording.userId) continue;
      const entries = recordingsByUser.get(recording.userId) ?? [];
      entries.push(recording);
      recordingsByUser.set(recording.userId, entries);
    }

    const collaborators = database.team.map((member) => {
      const calls = database.calls.filter((call) => call.userId === member.userId);
      const recordings = recordingsByUser.get(member.userId) ?? [];
      const durationSeconds = calls.reduce(
        (total, call) => total + (call.durationSeconds ?? 0),
        0,
      );
      const completed = calls.filter((call) => call.status === "completed").length;
      const failed = calls.filter((call) =>
        ["failed", "busy", "no_answer", "cancelled"].includes(call.status),
      ).length;
      return {
        ...member,
        calls: calls.length,
        completed,
        failed,
        durationSeconds,
        averageDurationSeconds:
          calls.length === 0 ? 0 : Math.round(durationSeconds / calls.length),
        recordings: recordings.length,
        transcriptions: recordings.filter(
          (recording) => recording.transcription?.status === "completed",
        ).length,
        lastCallAt: calls[0]?.startedAt ?? null,
      };
    });

    const durationSeconds = database.calls.reduce(
      (total, call) => total + (call.durationSeconds ?? 0),
      0,
    );
    return {
      date: filters.date,
      summary: {
        teamMembers: database.team.length,
        calls: database.calls.length,
        completed: database.calls.filter((call) => call.status === "completed")
          .length,
        failed: database.calls.filter((call) =>
          ["failed", "busy", "no_answer", "cancelled"].includes(call.status),
        ).length,
        durationSeconds,
        recordings: database.recordings.length,
        transcriptions: database.recordings.filter(
          (recording) => recording.transcription?.status === "completed",
        ).length,
      },
      collaborators,
    };
  }

  async dashboardAdmin(
    user: AuthenticatedUser,
    input: Record<string, unknown>,
  ) {
    const filters = parseDashboardFilters(input);
    const database = await this.databaseSnapshot(user, filters, 100_001);
    const calls = database.calls.slice(0, 100_000);
    const collaborators = database.team.map((member) => {
      const memberCalls = calls.filter((call) => call.userId === member.userId);
      const durations = memberCalls.flatMap((call) =>
        call.durationSeconds === null ? [] : [call.durationSeconds],
      );
      const durationSeconds = durations.reduce(
        (total, duration) => total + duration,
        0,
      );
      return {
        ...member,
        calls: memberCalls.length,
        completed: memberCalls.filter((call) => call.status === "completed").length,
        failed: memberCalls.filter((call) =>
          ["failed", "busy", "no_answer", "cancelled"].includes(call.status),
        ).length,
        durationSeconds,
        averageDurationSeconds:
          durations.length === 0
            ? null
            : Math.round(durationSeconds / durations.length),
        recordings: memberCalls.filter((call) => call.recording !== null).length,
        transcriptions: memberCalls.filter(
          (call) => call.recording?.transcription?.status === "completed",
        ).length,
        lastCallAt: memberCalls[0]?.startedAt ?? null,
      };
    });

    return {
      scope: "organization" as const,
      filters: {
        startDate: filters.startDate,
        endDate: filters.endDate,
        direction: filters.direction ?? null,
        userId: filters.userId ?? null,
        provider: filters.provider ?? null,
        status: filters.status ?? null,
        granularity: filters.granularity,
      },
      metrics: buildDashboardMetrics(calls),
      timeSeries: buildDashboardSeries(calls, filters.granularity),
      team: database.team,
      collaborators,
      items: calls,
      truncated: database.calls.length > calls.length,
      unavailableFields: {
        attemptStartedAt: false,
        answeredAt: false,
        endedAt: false,
        wrapUpEndedAt: true,
      },
    };
  }

  async collaborators(user: AuthenticatedUser) {
    return withOrganization(this.db, user.organizationId, async (tx) =>
      tx
        .select({
          userId: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          roleKey: schema.roles.key,
          role: schema.roles.name,
          membershipDeactivatedAt: schema.organizationUsers.deactivatedAt,
          extensionId: schema.telephonyExtensions.id,
          extension: schema.telephonyExtensions.extension,
          endpointId: schema.telephonyExtensions.endpointId,
          displayName: schema.telephonyExtensions.displayName,
          extensionStatus: schema.telephonyExtensions.status,
        })
        .from(schema.organizationUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.organizationUsers.userId))
        .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationUsers.roleId))
        .leftJoin(
          schema.telephonyExtensions,
          and(
            eq(
              schema.telephonyExtensions.organizationId,
              schema.organizationUsers.organizationId,
            ),
            eq(schema.telephonyExtensions.userId, schema.users.id),
          ),
        )
        .where(eq(schema.organizationUsers.organizationId, user.organizationId))
        .orderBy(schema.users.name),
    ).then((items) => ({
      items: items.map((item) => ({
        ...item,
        active:
          item.membershipDeactivatedAt === null &&
          item.extensionStatus !== "inactive",
      })),
    }));
  }

  async dialerContacts(user: AuthenticatedUser) {
    const items = await withOrganization(this.db, user.organizationId, async (tx) =>
      tx
        .select({
          id: schema.contacts.id,
          name: schema.contacts.name,
          email: schema.contacts.email,
          company: schema.contacts.company,
          notes: schema.contacts.notes,
          phoneNumber: schema.contactChannels.identifier,
        })
        .from(schema.contacts)
        .innerJoin(
          schema.contactChannels,
          and(
            eq(schema.contactChannels.contactId, schema.contacts.id),
            eq(schema.contactChannels.channelType, "phone"),
          ),
        )
        .orderBy(schema.contacts.name),
    );
    return { items };
  }

  async createDialerContact(user: AuthenticatedUser, input: Record<string, unknown>) {
    const parsed = createDialerContactSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("dados do contato inválidos");
    const phoneNumber = normalizeDialerPhone(parsed.data.phoneNumber);
    if (!phoneNumber) throw new BadRequestException("telefone brasileiro inválido");

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [contact] = await tx
        .insert(schema.contacts)
        .values({
          organizationId: user.organizationId,
          name: parsed.data.name,
          email: parsed.data.email || null,
          company: parsed.data.company || null,
          notes: parsed.data.notes || null,
        })
        .returning();
      if (!contact) throw new ServiceUnavailableException("contato não foi criado");
      try {
        await tx.insert(schema.contactChannels).values({
          organizationId: user.organizationId,
          contactId: contact.id,
          channelType: "phone",
          identifier: phoneNumber,
          isPrimary: "true",
        });
      } catch {
        throw new ConflictException("telefone já cadastrado");
      }
      return { ...contact, phoneNumber };
    });
  }

  async dialerCampaigns(user: AuthenticatedUser) {
    return withOrganization(this.db, user.organizationId, async (tx) => {
      const campaigns = await tx
        .select()
        .from(schema.dialerCampaigns)
        .orderBy(desc(schema.dialerCampaigns.createdAt));
      const items = campaigns.length
        ? await tx
            .select({
              campaignId: schema.dialerCampaignItems.campaignId,
              status: schema.dialerCampaignItems.status,
              assignedUserId: schema.dialerCampaignItems.assignedUserId,
            })
            .from(schema.dialerCampaignItems)
            .where(inArray(schema.dialerCampaignItems.campaignId, campaigns.map((item) => item.id)))
        : [];
      return {
        items: campaigns.map((campaign) => {
          const visible = items.filter(
            (item) =>
              item.campaignId === campaign.id &&
              (user.roleKey !== ROLES.agent ||
                item.assignedUserId === user.userId ||
                item.status === "pending"),
          );
          return {
            ...campaign,
            metrics: {
              total: visible.length,
              pending: visible.filter((item) => item.status === "pending").length,
              assigned: visible.filter((item) => item.status === "assigned").length,
              completed: visible.filter((item) => item.status === "completed").length,
              failed: visible.filter((item) => item.status === "failed").length,
              skipped: visible.filter((item) => item.status === "skipped").length,
            },
          };
        }),
      };
    });
  }

  async createDialerCampaign(user: AuthenticatedUser, input: Record<string, unknown>) {
    if (user.roleKey === ROLES.agent) {
      throw new ForbiddenException("somente supervisão pode criar campanhas");
    }
    const parsed = createCampaignSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("campanha inválida");

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const contacts = await tx
        .select({ id: schema.contacts.id, phoneNumber: schema.contactChannels.identifier })
        .from(schema.contacts)
        .innerJoin(
          schema.contactChannels,
          and(
            eq(schema.contactChannels.contactId, schema.contacts.id),
            eq(schema.contactChannels.channelType, "phone"),
          ),
        )
        .where(inArray(schema.contacts.id, parsed.data.contactIds));
      if (contacts.length !== new Set(parsed.data.contactIds).size) {
        throw new BadRequestException("um ou mais contatos não possuem telefone");
      }
      const [campaign] = await tx
        .insert(schema.dialerCampaigns)
        .values({
          organizationId: user.organizationId,
          name: parsed.data.name,
          provider: parsed.data.provider,
          createdBy: user.userId,
        })
        .returning();
      if (!campaign) throw new ServiceUnavailableException("campanha não foi criada");
      await tx.insert(schema.dialerCampaignItems).values(
        contacts.map((contact, index) => ({
          organizationId: user.organizationId,
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phoneNumber,
          position: index + 1,
        })),
      );
      return campaign;
    });
  }

  async setDialerCampaignStatus(
    user: AuthenticatedUser,
    campaignId: string,
    input: Record<string, unknown>,
  ) {
    if (user.roleKey === ROLES.agent) {
      throw new ForbiddenException("somente supervisão pode controlar campanhas");
    }
    const parsed = campaignStatusSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("status inválido");
    const now = new Date();
    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [campaign] = await tx
        .update(schema.dialerCampaigns)
        .set({
          status: parsed.data.status,
          startedAt: parsed.data.status === "active" ? now : undefined,
          completedAt: parsed.data.status === "completed" ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.dialerCampaigns.id, campaignId))
        .returning();
      if (!campaign) throw new NotFoundException("campanha não encontrada");
      return campaign;
    });
  }

  async claimNextDialerItem(user: AuthenticatedUser, campaignId: string) {
    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [campaign] = await tx
        .select({ id: schema.dialerCampaigns.id, provider: schema.dialerCampaigns.provider })
        .from(schema.dialerCampaigns)
        .where(and(eq(schema.dialerCampaigns.id, campaignId), eq(schema.dialerCampaigns.status, "active")))
        .limit(1);
      if (!campaign) throw new BadRequestException("campanha não está ativa");

      const [alreadyAssigned] = await tx
        .select({ id: schema.dialerCampaignItems.id })
        .from(schema.dialerCampaignItems)
        .where(and(
          eq(schema.dialerCampaignItems.campaignId, campaignId),
          eq(schema.dialerCampaignItems.assignedUserId, user.userId),
          eq(schema.dialerCampaignItems.status, "assigned"),
        ))
        .limit(1);
      const candidateId = alreadyAssigned?.id ?? (await tx
        .select({ id: schema.dialerCampaignItems.id })
        .from(schema.dialerCampaignItems)
        .where(and(
          eq(schema.dialerCampaignItems.campaignId, campaignId),
          eq(schema.dialerCampaignItems.status, "pending"),
        ))
        .orderBy(asc(schema.dialerCampaignItems.position))
        .limit(1))[0]?.id;
      if (!candidateId) return { item: null };

      const [claimed] = await tx
        .update(schema.dialerCampaignItems)
        .set({
          assignedUserId: user.userId,
          status: "assigned",
          claimedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.dialerCampaignItems.id, candidateId),
          alreadyAssigned ? eq(schema.dialerCampaignItems.assignedUserId, user.userId) : eq(schema.dialerCampaignItems.status, "pending"),
        ))
        .returning();
      if (!claimed) throw new ConflictException("contato atribuído a outro atendente; tente novamente");
      const [details] = await tx
        .select({
          id: schema.dialerCampaignItems.id,
          phoneNumber: schema.dialerCampaignItems.phoneNumber,
          contactId: schema.dialerCampaignItems.contactId,
          contactName: schema.contacts.name,
          company: schema.contacts.company,
        })
        .from(schema.dialerCampaignItems)
        .leftJoin(schema.contacts, eq(schema.contacts.id, schema.dialerCampaignItems.contactId))
        .where(eq(schema.dialerCampaignItems.id, claimed.id))
        .limit(1);
      return { item: details ? { ...details, provider: campaign.provider } : null };
    });
  }

  async completeDialerItem(
    user: AuthenticatedUser,
    itemId: string,
    input: Record<string, unknown>,
  ) {
    const parsed = campaignItemResultSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("resultado inválido");
    return withOrganization(this.db, user.organizationId, async (tx) => {
      const where: SQL[] = [eq(schema.dialerCampaignItems.id, itemId)];
      if (user.roleKey === ROLES.agent) {
        where.push(eq(schema.dialerCampaignItems.assignedUserId, user.userId));
      }
      const [item] = await tx
        .update(schema.dialerCampaignItems)
        .set({
          status: parsed.data.status,
          disposition: parsed.data.disposition,
          notes: parsed.data.notes || null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(...where))
        .returning();
      if (!item) throw new NotFoundException("item de campanha não encontrado");
      return item;
    });
  }

  async createCollaborator(
    user: AuthenticatedUser,
    input: Record<string, unknown>,
  ) {
    const parsed = createCollaboratorSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "dados do colaborador inválidos",
      );
    }
    const env = loadTelephonyEnv();
    const passwordHash = await hashPassword(parsed.data.password);

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [existingUser] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, parsed.data.email))
        .limit(1);
      if (existingUser) {
        throw new ConflictException("já existe um usuário com este e-mail");
      }

      const [role] = await tx
        .select({ id: schema.roles.id, key: schema.roles.key })
        .from(schema.roles)
        .where(eq(schema.roles.key, parsed.data.roleKey))
        .limit(1);
      if (!role) throw new BadRequestException("perfil de acesso não encontrado");

      const occupied = await tx
        .select({ extension: schema.telephonyExtensions.extension })
        .from(schema.telephonyExtensions);
      const occupiedExtensions = new Set(occupied.map((item) => item.extension));
      const requestedExtension = parsed.data.extension;
      if (requestedExtension) {
        const numeric = Number.parseInt(requestedExtension, 10);
        if (
          numeric < env.ASTERISK_EXTENSION_START ||
          numeric > env.ASTERISK_EXTENSION_END
        ) {
          throw new BadRequestException("ramal fora da faixa configurada");
        }
        if (occupiedExtensions.has(requestedExtension)) {
          throw new ConflictException("ramal já está em uso");
        }
      }

      const extension =
        requestedExtension ??
        Array.from(
          { length: env.ASTERISK_EXTENSION_END - env.ASTERISK_EXTENSION_START + 1 },
          (_, index) => String(env.ASTERISK_EXTENSION_START + index),
        ).find((candidate) => !occupiedExtensions.has(candidate));
      if (!extension) {
        throw new ConflictException("não há ramais disponíveis na faixa configurada");
      }

      const [createdUser] = await tx
        .insert(schema.users)
        .values({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
        })
        .returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });
      if (!createdUser) throw new ServiceUnavailableException("usuário não foi criado");

      await tx.insert(schema.organizationUsers).values({
        organizationId: user.organizationId,
        userId: createdUser.id,
        roleId: role.id,
      });
      const [createdExtension] = await tx
        .insert(schema.telephonyExtensions)
        .values({
          organizationId: user.organizationId,
          userId: createdUser.id,
          extension,
          endpointId: extension,
          displayName: parsed.data.name,
        })
        .returning({
          id: schema.telephonyExtensions.id,
          extension: schema.telephonyExtensions.extension,
          endpointId: schema.telephonyExtensions.endpointId,
        });

      return {
        userId: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        roleKey: role.key,
        ...createdExtension,
        active: true,
      };
    });
  }

  async setCollaboratorStatus(
    user: AuthenticatedUser,
    collaboratorUserId: string,
    input: Record<string, unknown>,
  ) {
    if (collaboratorUserId === user.userId) {
      throw new BadRequestException("o administrador não pode desativar a própria conta");
    }
    const parsed = collaboratorStatusSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("status inválido");
    const changedAt = new Date();
    const deactivatedAt = parsed.data.active ? null : changedAt;

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [membership] = await tx
        .select({ id: schema.organizationUsers.id })
        .from(schema.organizationUsers)
        .where(
          and(
            eq(schema.organizationUsers.organizationId, user.organizationId),
            eq(schema.organizationUsers.userId, collaboratorUserId),
          ),
        )
        .limit(1);
      if (!membership) throw new NotFoundException("colaborador não encontrado");

      await tx
        .update(schema.organizationUsers)
        .set({ deactivatedAt, updatedAt: changedAt })
        .where(eq(schema.organizationUsers.id, membership.id));
      await tx
        .update(schema.telephonyExtensions)
        .set({
          status: parsed.data.active ? "active" : "inactive",
          deactivatedAt,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(schema.telephonyExtensions.organizationId, user.organizationId),
            eq(schema.telephonyExtensions.userId, collaboratorUserId),
          ),
        );
      return { userId: collaboratorUserId, active: parsed.data.active };
    });
  }

  async retryTranscription(user: AuthenticatedUser, recordingId: string) {
    const conditions: SQL[] = [
      eq(schema.callRecordings.organizationId, user.organizationId),
      eq(schema.callRecordings.id, recordingId),
    ];
    const scopedUserId = scopedTelephonyUserId(user);
    if (scopedUserId) conditions.push(eq(schema.voiceCalls.userId, scopedUserId));

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const [recording] = await tx
        .select({
          id: schema.callRecordings.id,
          status: schema.callRecordings.status,
          transcriptionId: schema.callTranscriptions.id,
        })
        .from(schema.callRecordings)
        .innerJoin(schema.voiceCalls, eq(schema.voiceCalls.id, schema.callRecordings.callId))
        .leftJoin(
          schema.callTranscriptions,
          eq(schema.callTranscriptions.recordingId, schema.callRecordings.id),
        )
        .where(and(...conditions))
        .limit(1);
      if (!recording || recording.status !== "available") {
        throw new NotFoundException("gravação não disponível");
      }

      if (recording.transcriptionId) {
        await tx
          .update(schema.callTranscriptions)
          .set({
            status: "pending",
            errorMessage: null,
            attemptCount: 0,
            nextRetryAt: null,
            completedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.callTranscriptions.id, recording.transcriptionId));
      }
      return { ok: true, queued: true };
    });
  }

  async webRtcConfig(organizationId: string, userId: string) {
    const [extension] = await withOrganization(
      this.db,
      organizationId,
      async (tx) =>
        tx
          .select({
            extension: schema.telephonyExtensions.extension,
            endpointId: schema.telephonyExtensions.endpointId,
            displayName: schema.telephonyExtensions.displayName,
          })
          .from(schema.telephonyExtensions)
          .where(
            and(
              eq(schema.telephonyExtensions.organizationId, organizationId),
              eq(schema.telephonyExtensions.userId, userId),
              eq(schema.telephonyExtensions.status, "active"),
              isNull(schema.telephonyExtensions.deactivatedAt),
            ),
          )
          .limit(1),
    );

    if (!extension) {
      throw new NotFoundException("usuário sem ramal ativo");
    }

    const env = loadTelephonyEnv();
    const password = webRtcPassword(extension.endpointId, env);
    if (!password) {
      throw new ServiceUnavailableException("credencial do ramal não configurada");
    }

    return {
      extension: extension.extension,
      endpointId: extension.endpointId,
      displayName: extension.displayName,
      wsServer: env.ASTERISK_WSS_URL,
      sipDomain: env.ASTERISK_WEBRTC_DOMAIN,
      aor: `sip:${extension.extension}@${env.ASTERISK_WEBRTC_DOMAIN}`,
      authorizationUsername: extension.endpointId,
      authorizationPassword: password,
    };
  }

  async recordingAudio(user: AuthenticatedUser, recordingId: string) {
    const conditions: SQL[] = [
      eq(schema.callRecordings.organizationId, user.organizationId),
      eq(schema.callRecordings.id, recordingId),
    ];
    const scopedUserId = scopedTelephonyUserId(user);
    if (scopedUserId) conditions.push(eq(schema.voiceCalls.userId, scopedUserId));

    const [recording] = await withOrganization(
      this.db,
      user.organizationId,
      async (tx) =>
        tx
          .select({
            storageKey: schema.callRecordings.storageKey,
            fileName: schema.callRecordings.fileName,
            mimeType: schema.callRecordings.mimeType,
            sizeBytes: schema.callRecordings.sizeBytes,
            status: schema.callRecordings.status,
          })
          .from(schema.callRecordings)
          .innerJoin(
            schema.voiceCalls,
            eq(schema.voiceCalls.id, schema.callRecordings.callId),
          )
          .where(and(...conditions))
          .limit(1),
    );

    if (
      !recording ||
      recording.status !== "available" ||
      !safeRecordingId.test(recording.storageKey)
    ) {
      throw new NotFoundException("gravação não disponível");
    }

    const root = resolve(loadTelephonyEnv().ASTERISK_RECORDINGS_PATH);
    const filePath = resolve(root, `${recording.storageKey}.wav`);
    if (!filePath.startsWith(`${root}${sep}`)) {
      throw new NotFoundException("gravação não disponível");
    }
    await access(filePath, constants.R_OK).catch(() => {
      throw new NotFoundException("arquivo da gravação não encontrado");
    });

    return { ...recording, filePath };
  }

  private async databaseSnapshot(
    user: AuthenticatedUser,
    filters: ParsedTelephonyFilters,
    limit: number,
  ) {
    const scopedUserId = scopedTelephonyUserId(user, filters.userId);
    const teamConditions: SQL[] = [
      eq(schema.organizationUsers.organizationId, user.organizationId),
      isNull(schema.organizationUsers.deactivatedAt),
    ];
    if (user.roleKey === ROLES.agent) {
      teamConditions.push(eq(schema.organizationUsers.userId, user.userId));
    }

    const callConditions: SQL[] = [
      eq(schema.voiceCalls.organizationId, user.organizationId),
    ];
    if (scopedUserId) callConditions.push(eq(schema.voiceCalls.userId, scopedUserId));
    if (filters.start) callConditions.push(gte(schema.voiceCalls.startedAt, filters.start));
    if (filters.end) callConditions.push(lt(schema.voiceCalls.startedAt, filters.end));
    if (filters.provider) callConditions.push(eq(schema.voiceCalls.provider, filters.provider));
    if (filters.status) callConditions.push(eq(schema.voiceCalls.status, filters.status));
    if (filters.direction) {
      callConditions.push(eq(schema.voiceCalls.direction, filters.direction));
    }

    const recordingConditions: SQL[] = [
      eq(schema.callRecordings.organizationId, user.organizationId),
    ];
    if (scopedUserId) {
      recordingConditions.push(eq(schema.voiceCalls.userId, scopedUserId));
    }
    if (filters.start) {
      recordingConditions.push(gte(schema.voiceCalls.startedAt, filters.start));
    }
    if (filters.end) {
      recordingConditions.push(lt(schema.voiceCalls.startedAt, filters.end));
    }
    if (filters.provider) {
      recordingConditions.push(eq(schema.voiceCalls.provider, filters.provider));
    }
    if (filters.status) {
      recordingConditions.push(eq(schema.voiceCalls.status, filters.status));
    }
    if (filters.recordingStatus) {
      recordingConditions.push(
        eq(schema.callRecordings.status, filters.recordingStatus),
      );
    }
    if (filters.direction) {
      recordingConditions.push(eq(schema.voiceCalls.direction, filters.direction));
    }

    return withOrganization(this.db, user.organizationId, async (tx) => {
      const team = await tx
        .select({
          userId: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          role: schema.roles.name,
          extensionId: schema.telephonyExtensions.id,
          extension: schema.telephonyExtensions.extension,
          endpointId: schema.telephonyExtensions.endpointId,
          extensionStatus: schema.telephonyExtensions.status,
        })
        .from(schema.organizationUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.organizationUsers.userId))
        .innerJoin(schema.roles, eq(schema.roles.id, schema.organizationUsers.roleId))
        .leftJoin(
          schema.telephonyExtensions,
          and(
            eq(
              schema.telephonyExtensions.organizationId,
              schema.organizationUsers.organizationId,
            ),
            eq(schema.telephonyExtensions.userId, schema.users.id),
          ),
        )
        .where(and(...teamConditions))
        .orderBy(schema.users.name);

      const calls = await tx
        .select({
          id: schema.voiceCalls.id,
          userId: schema.voiceCalls.userId,
          externalCallId: schema.voiceCalls.externalCallId,
          direction: schema.voiceCalls.direction,
          provider: schema.voiceCalls.provider,
          fromNumber: schema.voiceCalls.fromNumber,
          toNumber: schema.voiceCalls.toNumber,
          status: schema.voiceCalls.status,
          userName: schema.users.name,
          extension: schema.telephonyExtensions.extension,
          startedAt: schema.voiceCalls.startedAt,
          answeredAt: schema.voiceCalls.answeredAt,
          endedAt: schema.voiceCalls.endedAt,
          durationSeconds: schema.voiceCalls.durationSeconds,
          hangupCause: schema.voiceCalls.hangupCause,
        })
        .from(schema.voiceCalls)
        .leftJoin(schema.users, eq(schema.users.id, schema.voiceCalls.userId))
        .leftJoin(
          schema.telephonyExtensions,
          eq(schema.telephonyExtensions.id, schema.voiceCalls.extensionId),
        )
        .where(and(...callConditions))
        .orderBy(desc(schema.voiceCalls.startedAt))
        .limit(limit);

      const contactNumbers = [
        ...new Set(
          calls.flatMap((call) => {
            const remoteNumber =
              call.direction === "inbound" ? call.fromNumber : call.toNumber;
            if (!remoteNumber) return [];
            let digits = remoteNumber.replace(/\D/g, "");
            if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
            return digits ? [digits] : [];
          }),
        ),
      ];
      const contactRows = contactNumbers.length
        ? await tx
            .select({
              identifier: schema.contactChannels.identifier,
              name: schema.contacts.name,
            })
            .from(schema.contactChannels)
            .innerJoin(
              schema.contacts,
              eq(schema.contacts.id, schema.contactChannels.contactId),
            )
            .where(
              and(
                eq(schema.contactChannels.organizationId, user.organizationId),
                eq(schema.contactChannels.channelType, "phone"),
                inArray(schema.contactChannels.identifier, contactNumbers),
              ),
            )
        : [];
      const contactsByNumber = new Map(
        contactRows.map((contact) => [contact.identifier, contact.name]),
      );

      const recordingRows = await tx
        .select({
          id: schema.callRecordings.id,
          callId: schema.callRecordings.callId,
          fileName: schema.callRecordings.fileName,
          status: schema.callRecordings.status,
          sizeBytes: schema.callRecordings.sizeBytes,
          durationSeconds: schema.callRecordings.durationSeconds,
          availableAt: schema.callRecordings.availableAt,
          createdAt: schema.callRecordings.createdAt,
          userId: schema.voiceCalls.userId,
          userName: schema.users.name,
          extension: schema.telephonyExtensions.extension,
          direction: schema.voiceCalls.direction,
          provider: schema.voiceCalls.provider,
          fromNumber: schema.voiceCalls.fromNumber,
          toNumber: schema.voiceCalls.toNumber,
          transcriptionId: schema.callTranscriptions.id,
          transcriptionStatus: schema.callTranscriptions.status,
          transcriptionProvider: schema.callTranscriptions.provider,
          transcriptionModel: schema.callTranscriptions.model,
          transcriptionLanguage: schema.callTranscriptions.language,
          transcriptionFullText: schema.callTranscriptions.fullText,
          transcriptionSegments: schema.callTranscriptions.segments,
          transcriptionError: schema.callTranscriptions.errorMessage,
          transcriptionCompletedAt: schema.callTranscriptions.completedAt,
        })
        .from(schema.callRecordings)
        .innerJoin(schema.voiceCalls, eq(schema.voiceCalls.id, schema.callRecordings.callId))
        .leftJoin(schema.users, eq(schema.users.id, schema.voiceCalls.userId))
        .leftJoin(
          schema.telephonyExtensions,
          eq(schema.telephonyExtensions.id, schema.voiceCalls.extensionId),
        )
        .leftJoin(
          schema.callTranscriptions,
          eq(schema.callTranscriptions.recordingId, schema.callRecordings.id),
        )
        .where(and(...recordingConditions))
        .orderBy(desc(schema.callRecordings.createdAt))
        .limit(limit);

      const recordings = recordingRows.map((recording) => ({
        id: recording.id,
        callId: recording.callId,
        fileName: recording.fileName,
        status: recording.status,
        sizeBytes: recording.sizeBytes,
        durationSeconds: recording.durationSeconds,
        availableAt: recording.availableAt,
        createdAt: recording.createdAt,
        userId: recording.userId,
        userName: recording.userName,
        extension: recording.extension,
        direction: recording.direction,
        provider: recording.provider,
        fromNumber: recording.fromNumber,
        toNumber: recording.toNumber,
        transcription: recording.transcriptionId
          ? {
              id: recording.transcriptionId,
              status: recording.transcriptionStatus,
              provider: recording.transcriptionProvider,
              model: recording.transcriptionModel,
              language: recording.transcriptionLanguage,
              fullText: recording.transcriptionFullText,
              segments: recording.transcriptionSegments,
              errorMessage: recording.transcriptionError,
              completedAt: recording.transcriptionCompletedAt,
            }
          : null,
      }));

      const recordingsByCallId = new Map(
        recordings.map((recording) => [recording.callId, recording]),
      );
      const enrichedCalls = calls.map((call) => {
        const contactNumber =
          call.direction === "inbound" ? call.fromNumber : call.toNumber;
        let contactLookupNumber = contactNumber?.replace(/\D/g, "") ?? "";
        if (
          contactLookupNumber.length === 10 ||
          contactLookupNumber.length === 11
        ) {
          contactLookupNumber = `55${contactLookupNumber}`;
        }
        return {
          ...call,
          contactName: contactsByNumber.get(contactLookupNumber) ?? null,
          contactNumber,
          ...callTiming(call),
          recording: recordingsByCallId.get(call.id) ?? null,
        };
      });

      return { team, calls: enrichedCalls, recordings };
    });
  }

  private async asteriskSnapshot(): Promise<AsteriskSnapshot> {
    const env = loadTelephonyEnv();
    const authorization = Buffer.from(
      `${env.ASTERISK_ARI_USERNAME}:${env.ASTERISK_ARI_PASSWORD}`,
      "utf8",
    ).toString("base64");
    const headers = { authorization: `Basic ${authorization}` };

    try {
      const [info, endpoints, channels] = await Promise.all([
        this.fetchAri("/ari/asterisk/info?only=system", env.ASTERISK_ARI_URL, headers),
        this.fetchAri("/ari/endpoints/PJSIP", env.ASTERISK_ARI_URL, headers),
        this.fetchAri("/ari/channels", env.ASTERISK_ARI_URL, headers),
      ]);
      return summarizeAri({ info, endpoints, channels });
    } catch {
      return {
        available: false,
        version: null,
        trunk: { endpoint: "directcall", status: "unknown" },
        trunks: [
          { endpoint: "directcall", label: "DirectCall", status: "unknown" },
          { endpoint: "wavoip", label: "WhatsApp", status: "unknown" },
          { endpoint: "twilio", label: "Twilio", status: "unknown" },
        ],
        endpointStates: {},
        activeChannels: 0,
        activeCalls: 0,
      };
    }
  }

  private async fetchAri(
    path: string,
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, baseUrl), {
      headers,
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error(`ARI respondeu HTTP ${response.status}`);
    }
    return response.json();
  }
}
