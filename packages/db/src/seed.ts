import { sql } from "drizzle-orm";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, type RoleKey } from "@omni/auth";
import { createDatabase } from "./client";
import { permissions, rolePermissions, roles } from "./schema";

const ROLE_NAMES: Record<RoleKey, string> = {
  [ROLES.admin]: "Administrador",
  [ROLES.supervisor]: "Supervisor",
  [ROLES.agent]: "Atendente",
  [ROLES.auditor]: "Auditor",
};

/**
 * Idempotente: roda a cada deploy sem duplicar nem apagar vínculos existentes.
 * Perfis e permissões são catálogo do produto, não dado de tenant, por isso
 * ficam fora do escopo de RLS.
 */
export async function seedRolesAndPermissions(connectionString: string): Promise<void> {
  const { db, close } = createDatabase({ connectionString, maxConnections: 1 });

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(permissions)
        .values(Object.values(PERMISSIONS).map((key) => ({ key })))
        .onConflictDoNothing({ target: permissions.key });

      await tx
        .insert(roles)
        .values(
          Object.values(ROLES).map((key) => ({ key, name: ROLE_NAMES[key as RoleKey] })),
        )
        .onConflictDoNothing({ target: roles.key });

      const roleRows = await tx.select({ id: roles.id, key: roles.key }).from(roles);
      const permissionRows = await tx
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions);

      const permissionIdByKey = new Map(permissionRows.map((row) => [row.key, row.id]));

      const links = roleRows.flatMap((role) =>
        (ROLE_PERMISSIONS[role.key as RoleKey] ?? []).flatMap((permissionKey) => {
          const permissionId = permissionIdByKey.get(permissionKey);
          return permissionId ? [{ roleId: role.id, permissionId }] : [];
        }),
      );

      if (links.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(links)
          .onConflictDoNothing({
            target: [rolePermissions.roleId, rolePermissions.permissionId],
          });
      }

      await tx.execute(sql`select 1`);
    });
  } finally {
    await close();
  }
}

if (require.main === module) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida");
  }
  seedRolesAndPermissions(connectionString)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("perfis e permissões sincronizados");
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
