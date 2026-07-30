import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withOrganization, type Database } from "./client";
import { auditLogs, organizations } from "./schema";

const connectionString = process.env.DATABASE_URL;

/**
 * Prova o critério de aceite mais importante da plataforma: um tenant não
 * alcança dados de outro. Precisa de Postgres real — RLS é comportamento do
 * banco e não pode ser verificado com mock.
 */
describe.skipIf(!connectionString)("RLS: isolamento entre organizações", () => {
  let db: Database;
  let close: () => Promise<void>;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    ({ db, close } = createDatabase({ connectionString: connectionString!, maxConnections: 2 }));

    // A criação de organização acontece fora do escopo de um tenant, então
    // roda com RLS desativado nesta sessão administrativa.
    await db.execute(sql`set local role none`).catch(() => undefined);

    const [a] = await db
      .insert(organizations)
      .values({ name: "Org A", slug: `org-a-${Date.now()}` })
      .returning({ id: organizations.id });
    const [b] = await db
      .insert(organizations)
      .values({ name: "Org B", slug: `org-b-${Date.now()}` })
      .returning({ id: organizations.id });

    orgA = a!.id;
    orgB = b!.id;

    await db.insert(auditLogs).values([
      { organizationId: orgA, action: "test.a", resourceType: "test" },
      { organizationId: orgB, action: "test.b", resourceType: "test" },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(auditLogs).where(sql`organization_id in (${orgA}, ${orgB})`);
      await db.delete(organizations).where(sql`id in (${orgA}, ${orgB})`);
      await close();
    }
  });

  it("só enxerga os audit_logs da organização da sessão", async () => {
    const rows = await withOrganization(db, orgA, (tx) => tx.select().from(auditLogs));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === orgA)).toBe(true);
  });

  it("não permite gravar audit_log em nome de outra organização", async () => {
    await expect(
      withOrganization(db, orgA, (tx) =>
        tx.insert(auditLogs).values({
          organizationId: orgB,
          action: "test.invasao",
          resourceType: "test",
        }),
      ),
    ).rejects.toThrow();
  });

  it("não devolve linha alguma quando a sessão não define o tenant", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', '', true)`);
      return tx.select().from(auditLogs);
    });

    expect(rows).toHaveLength(0);
  });

  it("bloqueia update na trilha de auditoria, que é append-only", async () => {
    await expect(
      withOrganization(db, orgA, (tx) =>
        tx.update(auditLogs).set({ action: "adulterado" }),
      ),
    ).rejects.toThrow();
  });
});
