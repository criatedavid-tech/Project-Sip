import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withOrganization, type Database } from "./client";
import { auditLogs, organizations } from "./schema";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const enabled = Boolean(appUrl && adminUrl);

/**
 * Prova o critério de aceite mais importante da plataforma: um tenant não
 * alcança dados de outro.
 *
 * Precisa de Postgres real — RLS é comportamento do banco e não pode ser
 * verificado com mock. As asserções rodam pela conexão da APLICAÇÃO; usar a
 * conexão administrativa aqui invalidaria o teste, porque superusuário ignora
 * RLS e tudo passaria.
 */
describe.skipIf(!enabled)("RLS: isolamento entre organizações", () => {
  let app: Database;
  let admin: Database;
  let closeApp: () => Promise<void>;
  let closeAdmin: () => Promise<void>;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    ({ db: app, close: closeApp } = createDatabase({
      connectionString: appUrl!,
      maxConnections: 2,
    }));
    ({ db: admin, close: closeAdmin } = createDatabase({
      connectionString: adminUrl!,
      maxConnections: 2,
    }));

    const suffix = Date.now();
    const [a] = await admin
      .insert(organizations)
      .values({ name: "Org A", slug: `rls-a-${suffix}` })
      .returning({ id: organizations.id });
    const [b] = await admin
      .insert(organizations)
      .values({ name: "Org B", slug: `rls-b-${suffix}` })
      .returning({ id: organizations.id });

    orgA = a!.id;
    orgB = b!.id;

    await admin.insert(auditLogs).values([
      { organizationId: orgA, action: "test.a", resourceType: "test" },
      { organizationId: orgB, action: "test.b", resourceType: "test" },
    ]);
  });

  afterAll(async () => {
    if (admin) {
      await admin.delete(auditLogs).where(sql`organization_id in (${orgA}, ${orgB})`);
      await admin.delete(organizations).where(sql`id in (${orgA}, ${orgB})`);
      await Promise.all([closeApp(), closeAdmin()]);
    }
  });

  it("a role da aplicação não pode ignorar RLS", async () => {
    const [row] = await app.execute<{ usesuper: boolean; usebypassrls: boolean }>(
      sql`select usesuper, usebypassrls from pg_user where usename = current_user`,
    );

    expect(row!.usesuper).toBe(false);
    expect(row!.usebypassrls).toBe(false);
  });

  it("só enxerga os audit_logs da organização da sessão", async () => {
    const rows = await withOrganization(app, orgA, (tx) => tx.select().from(auditLogs));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === orgA)).toBe(true);
    expect(rows.some((row) => row.action === "test.b")).toBe(false);
  });

  it("não permite gravar audit_log em nome de outra organização", async () => {
    await expect(
      withOrganization(app, orgA, (tx) =>
        tx.insert(auditLogs).values({
          organizationId: orgB,
          action: "test.invasao",
          resourceType: "test",
        }),
      ),
    ).rejects.toThrow();
  });

  it("não devolve linha alguma quando a sessão não define o tenant", async () => {
    const rows = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', '', true)`);
      return tx.select().from(auditLogs);
    });

    expect(rows).toHaveLength(0);
  });

  it("não altera a trilha de auditoria, que é append-only", async () => {
    // Sem política de UPDATE o Postgres não lança erro: apenas nenhuma linha
    // fica visível para alteração. O que importa é o dado seguir intacto.
    await withOrganization(app, orgA, (tx) =>
      tx.update(auditLogs).set({ action: "adulterado" }),
    );

    const rows = await admin
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgA));

    expect(rows.every((row) => row.action === "test.a")).toBe(true);
  });

  it("não apaga a trilha de auditoria", async () => {
    await withOrganization(app, orgA, (tx) => tx.delete(auditLogs));

    const rows = await admin
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgA));

    expect(rows.length).toBeGreaterThan(0);
  });
});
