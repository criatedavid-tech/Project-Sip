import { eq } from "drizzle-orm";
import { ROLES, hashPassword, type RoleKey } from "@omni/auth";
import { createDatabase } from "./client";
import { organizationUsers, organizations, roles, users } from "./schema";

export interface CreateOrganizationOptions {
  adminConnectionString: string;
  organizationName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface CreateOrganizationResult {
  organizationId: string;
  userId: string;
}

/**
 * Cria a primeira organização e seu administrador — o acesso inicial, que não
 * pode ser criado pela própria interface porque ainda não há ninguém para
 * autenticar. Roda pela conexão administrativa: ainda não existe tenant a
 * fixar na sessão.
 *
 * Idempotente quanto ao usuário: se o e-mail já existe, apenas vincula à nova
 * organização em vez de falhar.
 */
export async function createOrganizationWithAdmin(
  options: CreateOrganizationOptions,
): Promise<CreateOrganizationResult> {
  const { db, close } = createDatabase({
    connectionString: options.adminConnectionString,
    maxConnections: 1,
  });

  try {
    return await db.transaction(async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(eq(roles.key, ROLES.admin satisfies RoleKey))
        .limit(1);

      if (!role) {
        throw new Error("perfis não encontrados — rode o seed antes");
      }

      const [organization] = await tx
        .insert(organizations)
        .values({ name: options.organizationName, slug: options.slug })
        .returning();

      const email = options.adminEmail.toLowerCase().trim();
      const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);

      const user =
        existing ??
        (
          await tx
            .insert(users)
            .values({
              email,
              name: options.adminName,
              passwordHash: await hashPassword(options.adminPassword),
            })
            .returning()
        )[0]!;

      await tx.insert(organizationUsers).values({
        organizationId: organization!.id,
        userId: user.id,
        roleId: role.id,
      });

      return { organizationId: organization!.id, userId: user.id };
    });
  } finally {
    await close();
  }
}

if (require.main === module) {
  const [organizationName, slug, adminName, adminEmail, adminPassword] =
    process.argv.slice(2);
  const adminConnectionString = process.env.DATABASE_ADMIN_URL;

  if (!adminConnectionString) {
    throw new Error("DATABASE_ADMIN_URL não definida");
  }
  if (!organizationName || !slug || !adminName || !adminEmail || !adminPassword) {
    throw new Error(
      'uso: pnpm db:create-org "<Organização>" <slug> "<Nome do admin>" <email> <senha>',
    );
  }
  if (adminPassword.length < 12) {
    throw new Error("a senha do administrador precisa ter ao menos 12 caracteres");
  }

  createOrganizationWithAdmin({
    adminConnectionString,
    organizationName,
    slug,
    adminName,
    adminEmail,
    adminPassword,
  })
    .then((result) => {
      // A senha não é ecoada: ela veio da linha de comando e já está no histórico
      // do shell; repeti-la no log só amplia a exposição.
      // eslint-disable-next-line no-console
      console.log(
        `organização "${organizationName}" criada (${result.organizationId})\nadministrador: ${adminEmail}`,
      );
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
