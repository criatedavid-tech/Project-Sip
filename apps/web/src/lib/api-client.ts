export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
}

export interface LoginResponse {
  accessToken: string;
  organizationId: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    // Necessário para o cookie httpOnly do refresh token trafegar.
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    throw new ApiError(await extractMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function extractMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    return message ?? `erro ${response.status}`;
  } catch {
    return `erro ${response.status}`;
  }
}

export interface ConversationListItem {
  id: string;
  status: string;
  contactId: string;
  contactName: string | null;
  contactIdentifier: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  withinServiceWindow: boolean;
  unreadCount: number;
  lastMessagePreview: string | null;
}

export interface Message {
  id: string;
  direction: "inbound" | "outbound";
  senderType: string;
  contentType: string;
  body: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ThreadResponse {
  conversation: {
    id: string;
    status: string;
    lastInboundAt: string | null;
    withinServiceWindow: boolean;
  };
  messages: Message[];
}

export interface TelephonyTeamMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  extensionId: string | null;
  extension: string | null;
  endpointId: string | null;
  extensionStatus: string | null;
  endpointStatus: "online" | "offline" | "unknown" | "unassigned";
}

export interface VoiceCall {
  id: string;
  userId: string | null;
  externalCallId: string;
  direction: string;
  provider: string;
  fromNumber: string | null;
  toNumber: string | null;
  status: string;
  userName: string | null;
  extension: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  hangupCause: string | null;
  contactName: string | null;
  contactNumber: string | null;
  answerTimeSeconds: number | null;
  wrapUpTimeSeconds: number | null;
  recording: CallRecording | null;
}

export interface CallRecording {
  id: string;
  callId: string;
  userId: string | null;
  fileName: string;
  status: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  availableAt: string | null;
  createdAt: string;
  userName: string | null;
  extension: string | null;
  direction: string;
  provider: string;
  fromNumber: string | null;
  toNumber: string | null;
  transcription: CallTranscription | null;
}

export interface TranscriptionSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence?: number;
}

export interface CallTranscription {
  id: string;
  status: string;
  provider: string;
  model: string | null;
  language: string | null;
  fullText: string | null;
  segments: TranscriptionSegment[] | null;
  errorMessage: string | null;
  completedAt: string | null;
}

export interface TelephonyOverview {
  generatedAt: string;
  scope: "own" | "organization";
  asterisk: {
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
    activeChannels: number;
    activeCalls: number;
  };
  summary: {
    activeCalls: number;
    onlineExtensions: number;
    teamMembers: number;
    calls: number;
    recordings: number;
    transcriptions: number;
  };
  team: TelephonyTeamMember[];
  calls: VoiceCall[];
  recordings: CallRecording[];
}

export interface TelephonyFilters {
  date?: string;
  userId?: string;
  provider?: string;
  status?: string;
  direction?: "inbound" | "outbound";
}

export interface TelephonyListResponse<T> {
  scope: "own" | "organization";
  filters: {
    date: string | null;
    userId: string | null;
    provider: string | null;
    status: string | null;
  };
  items: T[];
}

export interface TelephonyDailyCollaborator
  extends Omit<TelephonyTeamMember, "endpointStatus"> {
  calls: number;
  completed: number;
  failed: number;
  durationSeconds: number;
  averageDurationSeconds: number | null;
  recordings: number;
  transcriptions: number;
  lastCallAt: string | null;
}

export interface TelephonyDailyAdmin {
  date: string;
  summary: {
    teamMembers: number;
    calls: number;
    completed: number;
    failed: number;
    durationSeconds: number;
    recordings: number;
    transcriptions: number;
  };
  collaborators: TelephonyDailyCollaborator[];
}

export type DashboardGranularity = "hour" | "day" | "week" | "month";

export interface TelephonyDashboardFilters {
  startDate: string;
  endDate: string;
  direction?: "inbound" | "outbound";
  userId?: string;
  provider?: string;
  status?: string;
  granularity: DashboardGranularity;
}

export interface TelephonyDashboardResponse {
  scope: "organization";
  filters: {
    startDate: string;
    endDate: string;
    direction: "inbound" | "outbound" | null;
    userId: string | null;
    provider: string | null;
    status: string | null;
    granularity: DashboardGranularity;
  };
  metrics: {
    averageHandleTimeSeconds: number | null;
    totalCalls: number;
    totalConversationSeconds: number;
    averageConversationSeconds: number | null;
    completedCalls: number;
    failedCalls: number;
  };
  timeSeries: Array<{
    key: string;
    label: string;
    inbound: number;
    outbound: number;
    total: number;
  }>;
  team: TelephonyTeamMember[];
  collaborators: TelephonyDailyCollaborator[];
  items: VoiceCall[];
  truncated: boolean;
  unavailableFields: {
    attemptStartedAt: boolean;
    answeredAt: boolean;
    endedAt: boolean;
    wrapUpEndedAt: boolean;
  };
}

export interface TelephonyCollaborator {
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  role: string;
  extensionId: string | null;
  extension: string | null;
  endpointId: string | null;
  displayName: string | null;
  extensionStatus: string | null;
  membershipDeactivatedAt: string | null;
  active: boolean;
}

export interface CreateTelephonyCollaborator {
  name: string;
  email: string;
  password: string;
  roleKey: "agent" | "supervisor";
  extension?: string;
}

export interface DialerContact {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  phoneNumber: string;
}

export interface DialerCampaignMetrics {
  total: number;
  pending: number;
  assigned: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface DialerCampaign {
  id: string;
  name: string;
  provider: "directcall" | "wavoip" | "twilio";
  status: "draft" | "active" | "paused" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  metrics: DialerCampaignMetrics;
}

export interface DialerCampaignItem {
  id: string;
  phoneNumber: string;
  contactId: string | null;
  contactName: string | null;
  company: string | null;
  provider: DialerCampaign["provider"];
}

export interface WebRtcConfig {
  extension: string;
  endpointId: string;
  displayName: string;
  wsServer: string;
  sipDomain: string;
  aor: string;
  authorizationUsername: string;
  authorizationPassword: string;
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  /** Renova a sessão usando apenas o cookie httpOnly. */
  refresh(): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/refresh", { method: "POST" });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },

  me(accessToken: string): Promise<{
    userId: string;
    organizationId: string;
    roleKey: string;
    permissions: string[];
  }> {
    return request("/auth/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  },

  conversations(accessToken: string): Promise<ConversationListItem[]> {
    return request("/conversations", { headers: auth(accessToken) });
  },

  telephonyOverview(accessToken: string): Promise<TelephonyOverview> {
    return request("/telephony/overview", { headers: auth(accessToken) });
  },

  telephonyCalls(
    accessToken: string,
    filters: TelephonyFilters = {},
  ): Promise<TelephonyListResponse<VoiceCall>> {
    return request(`/telephony/calls${queryString(filters)}`, {
      headers: auth(accessToken),
    });
  },

  telephonyRecordings(
    accessToken: string,
    filters: TelephonyFilters = {},
  ): Promise<TelephonyListResponse<CallRecording>> {
    return request(`/telephony/recordings${queryString(filters)}`, {
      headers: auth(accessToken),
    });
  },

  telephonyDailyAdmin(
    accessToken: string,
    date: string,
  ): Promise<TelephonyDailyAdmin> {
    return request(`/telephony/admin/daily${queryString({ date })}`, {
      headers: auth(accessToken),
    });
  },

  telephonyAdminDashboard(
    accessToken: string,
    filters: TelephonyDashboardFilters,
  ): Promise<TelephonyDashboardResponse> {
    return request(`/telephony/admin/dashboard${queryString(filters)}`, {
      headers: auth(accessToken),
    });
  },

  telephonyCollaborators(
    accessToken: string,
  ): Promise<{ items: TelephonyCollaborator[] }> {
    return request("/telephony/admin/collaborators", {
      headers: auth(accessToken),
    });
  },

  createTelephonyCollaborator(
    accessToken: string,
    input: CreateTelephonyCollaborator,
  ): Promise<TelephonyCollaborator> {
    return request("/telephony/admin/collaborators", {
      method: "POST",
      headers: auth(accessToken),
      body: JSON.stringify(input),
    });
  },

  setTelephonyCollaboratorStatus(
    accessToken: string,
    userId: string,
    active: boolean,
  ): Promise<{ userId: string; active: boolean }> {
    return request(`/telephony/admin/collaborators/${userId}/status`, {
      method: "PATCH",
      headers: auth(accessToken),
      body: JSON.stringify({ active }),
    });
  },

  webRtcConfig(accessToken: string): Promise<WebRtcConfig> {
    return request("/telephony/webrtc-config", { headers: auth(accessToken) });
  },

  async recordingAudio(accessToken: string, recordingId: string): Promise<Blob> {
    const response = await fetch(
      `${baseUrl}/telephony/recordings/${recordingId}/audio`,
      {
        credentials: "include",
        headers: auth(accessToken),
      },
    );
    if (!response.ok) {
      throw new ApiError(await extractMessage(response), response.status);
    }
    return response.blob();
  },

  retryTranscription(
    accessToken: string,
    recordingId: string,
  ): Promise<{ ok: boolean; queued: boolean }> {
    return request(`/telephony/recordings/${recordingId}/retry-transcription`, {
      method: "POST",
      headers: auth(accessToken),
    });
  },

  dialerContacts(accessToken: string): Promise<{ items: DialerContact[] }> {
    return request("/telephony/dialer/contacts", { headers: auth(accessToken) });
  },

  createDialerContact(
    accessToken: string,
    input: {
      name: string;
      phoneNumber: string;
      email?: string;
      company?: string;
      notes?: string;
    },
  ): Promise<DialerContact> {
    return request("/telephony/dialer/contacts", {
      method: "POST",
      headers: auth(accessToken),
      body: JSON.stringify(input),
    });
  },

  dialerCampaigns(accessToken: string): Promise<{ items: DialerCampaign[] }> {
    return request("/telephony/dialer/campaigns", {
      headers: auth(accessToken),
    });
  },

  createDialerCampaign(
    accessToken: string,
    input: {
      name: string;
      provider: DialerCampaign["provider"];
      contactIds: string[];
    },
  ): Promise<DialerCampaign> {
    return request("/telephony/dialer/campaigns", {
      method: "POST",
      headers: auth(accessToken),
      body: JSON.stringify(input),
    });
  },

  setDialerCampaignStatus(
    accessToken: string,
    campaignId: string,
    status: DialerCampaign["status"],
  ): Promise<DialerCampaign> {
    return request(`/telephony/dialer/campaigns/${campaignId}/status`, {
      method: "PATCH",
      headers: auth(accessToken),
      body: JSON.stringify({ status }),
    });
  },

  claimNextDialerItem(
    accessToken: string,
    campaignId: string,
  ): Promise<{ item: DialerCampaignItem | null }> {
    return request(`/telephony/dialer/campaigns/${campaignId}/next`, {
      method: "POST",
      headers: auth(accessToken),
    });
  },

  completeDialerItem(
    accessToken: string,
    itemId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      disposition: string;
      notes?: string;
    },
  ): Promise<unknown> {
    return request(`/telephony/dialer/items/${itemId}/result`, {
      method: "PATCH",
      headers: auth(accessToken),
      body: JSON.stringify(input),
    });
  },

  thread(accessToken: string, conversationId: string): Promise<ThreadResponse> {
    return request(`/conversations/${conversationId}/messages`, {
      headers: auth(accessToken),
    });
  },

  sendMessage(
    accessToken: string,
    conversationId: string,
    body: string,
  ): Promise<Message> {
    return request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: auth(accessToken),
      body: JSON.stringify({ body }),
    });
  },

  markRead(accessToken: string, conversationId: string): Promise<{ ok: boolean }> {
    return request(`/conversations/${conversationId}/read`, {
      method: "POST",
      headers: auth(accessToken),
    });
  },
};

function auth(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

function queryString(filters: TelephonyFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}
