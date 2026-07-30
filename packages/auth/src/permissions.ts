export const PERMISSIONS = {
  contactsRead: "contacts:read",
  contactsWrite: "contacts:write",
  conversationsRead: "conversations:read",
  conversationsWrite: "conversations:write",
  callsRead: "calls:read",
  callsWrite: "calls:write",
  recordingsListen: "recordings:listen",
  recordingsDownload: "recordings:download",
  transcriptionsRead: "transcriptions:read",
  usersManage: "users:manage",
  organizationManage: "organization:manage",
  channelsManage: "channels:manage",
  auditRead: "audit:read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLES = {
  admin: "admin",
  supervisor: "supervisor",
  agent: "agent",
  auditor: "auditor",
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/**
 * Menor privilégio por padrão: atendente não baixa gravação nem lê auditoria,
 * e auditor só lê. Ouvir e baixar gravação são permissões distintas porque
 * download tira o áudio do controle de acesso da plataforma.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [ROLES.admin]: Object.values(PERMISSIONS),
  [ROLES.supervisor]: [
    PERMISSIONS.contactsRead,
    PERMISSIONS.contactsWrite,
    PERMISSIONS.conversationsRead,
    PERMISSIONS.conversationsWrite,
    PERMISSIONS.callsRead,
    PERMISSIONS.callsWrite,
    PERMISSIONS.recordingsListen,
    PERMISSIONS.recordingsDownload,
    PERMISSIONS.transcriptionsRead,
    PERMISSIONS.auditRead,
  ],
  [ROLES.agent]: [
    PERMISSIONS.contactsRead,
    PERMISSIONS.contactsWrite,
    PERMISSIONS.conversationsRead,
    PERMISSIONS.conversationsWrite,
    PERMISSIONS.callsRead,
    PERMISSIONS.callsWrite,
    PERMISSIONS.recordingsListen,
    PERMISSIONS.transcriptionsRead,
  ],
  [ROLES.auditor]: [
    PERMISSIONS.contactsRead,
    PERMISSIONS.conversationsRead,
    PERMISSIONS.callsRead,
    PERMISSIONS.recordingsListen,
    PERMISSIONS.transcriptionsRead,
    PERMISSIONS.auditRead,
  ],
};

export function hasPermission(granted: string[], required: Permission): boolean {
  return granted.includes(required);
}
