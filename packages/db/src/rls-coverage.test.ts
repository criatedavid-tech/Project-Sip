import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";

const adminUrl = process.env.DATABASE_ADMIN_URL;

/**
 * Tabelas com organization_id que, por decisão explícita, não têm RLS.
 * Qualquer adição aqui precisa de justificativa — é uma exceção ao isolamento.
 */
const RLS_EXEMPT = new Set([
  // O webhook chega antes de sabermos a que organização pertence; a resolução
  // acontece no processamento, pela conexão administrativa.
  "webhook_deliveries",
]);

/**
 * Rede de segurança contra a falha mais fácil de cometer e mais difícil de
 * perceber: criar uma tabela de negócio e esquecer a política de RLS. O
 * vazamento entre tenants seria silencioso, então o catálogo do banco é
 * inspecionado a cada execução.
 */
describe.skipIf(!adminUrl)("cobertura de RLS", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(() => {
    ({ db, close } = createDatabase({ connectionString: adminUrl!, maxConnections: 1 }));
  });

  afterAll(async () => {
    if (db) {
      await close();
    }
  });

  it("toda tabela com organization_id tem RLS habilitado e forçado", async () => {
    const rows = await db.execute<{
      tablename: string;
      rowsecurity: boolean;
      forced: boolean;
    }>(sql`
      select c.relname as tablename,
             c.relrowsecurity as rowsecurity,
             c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'organization_id'
        )
    `);

    const desprotegidas = rows
      .filter((row) => !RLS_EXEMPT.has(row.tablename))
      .filter((row) => !row.rowsecurity || !row.forced)
      .map((row) => row.tablename);

    expect(rows.length).toBeGreaterThan(0);
    expect(desprotegidas).toEqual([]);
  });

  it("nenhuma tabela com RLS habilitado ficou sem política, o que bloquearia tudo", async () => {
    const rows = await db.execute<{ tablename: string; policies: number }>(sql`
      select c.relname as tablename,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity = true
    `);

    const semPolitica = rows.filter((row) => row.policies === 0).map((row) => row.tablename);

    expect(semPolitica).toEqual([]);
  });

  it("a role da aplicação recebe privilégios nas tabelas criadas por migrações novas", async () => {
    // ALTER DEFAULT PRIVILEGES só alcança tabelas criadas pela mesma role que o
    // configurou. Se as migrações passarem a rodar por outra role, o acesso some
    // sem aviso e a aplicação quebra só em runtime.
    const rows = await db.execute<{ table_name: string; privileges: string }>(sql`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where grantee = 'omni_app'
        and table_name in (
          'messages',
          'conversations',
          'contacts',
          'event_outbox',
          'telephony_extensions',
          'voice_calls',
          'call_recordings',
          'call_transcriptions'
        )
      group by table_name
    `);

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.privileges).toBe("DELETE,INSERT,SELECT,UPDATE");
    }
  });

  it("as tabelas append-only não têm política de UPDATE nem DELETE", async () => {
    const rows = await db.execute<{ tablename: string; cmd: string }>(sql`
      select c.relname as tablename, p.polcmd as cmd
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname in ('audit_logs', 'message_status_events')
    `);

    // polcmd: 'r' select, 'a' insert, 'w' update, 'd' delete, '*' todos
    const mutaveis = rows.filter((row) => ["w", "d", "*"].includes(row.cmd));

    expect(mutaveis).toEqual([]);
  });
});
