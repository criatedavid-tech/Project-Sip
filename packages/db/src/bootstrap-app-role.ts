import { sql } from "drizzle-orm";
import { createDatabase } from "./client";

export interface BootstrapAppRoleOptions {
  /** Conexão administrativa (dona das tabelas). */
  adminConnectionString: string;
  appUser: string;
  appPassword: string;
  database: string;
}

/**
 * Cria a role que a aplicação usa em runtime.
 *
 * Precisa existir separada da role administrativa porque o Postgres deixa
 * superusuário ignorar Row Level Security — inclusive com FORCE ROW LEVEL
 * SECURITY. Rodar a aplicação com o mesmo usuário que cria as tabelas
 * desliga o isolamento multi-tenant sem nenhum aviso.
 *
 * Idempotente: pode rodar a cada deploy.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Postgres não aceita parâmetro vinculado em DDL, então o valor é escapado. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function bootstrapAppRole(options: BootstrapAppRoleOptions): Promise<void> {
  if (!SAFE_IDENTIFIER.test(options.appUser)) {
    throw new Error(`APP_DB_USER inválido: ${options.appUser}`);
  }

  const { db, close } = createDatabase({
    connectionString: options.adminConnectionString,
    maxConnections: 1,
  });

  const user = sql.identifier(options.appUser);
  const database = sql.identifier(options.database);
  const password = quoteLiteral(options.appPassword);

  try {
    const existing = await db.execute(
      sql`select 1 from pg_roles where rolname = ${options.appUser}`,
    );

    if (existing.length === 0) {
      await db.execute(sql`create role ${user} login password ${sql.raw(password)}`);
    } else {
      await db.execute(sql`alter role ${user} login password ${sql.raw(password)}`);
    }

    // Uma role comum já nasce restrita; reafirmamos para o caso de ela ter sido
    // criada à mão com privilégios que anulariam o RLS.
    await db.execute(sql`alter role ${user} nosuperuser nobypassrls nocreatedb nocreaterole`);

    await db.execute(sql`grant connect on database ${database} to ${user}`);
    await db.execute(sql`grant usage on schema public to ${user}`);
    await db.execute(
      sql`grant select, insert, update, delete on all tables in schema public to ${user}`,
    );
    await db.execute(sql`grant usage, select on all sequences in schema public to ${user}`);

    // Tabelas criadas por migrações futuras já nascem acessíveis à aplicação.
    await db.execute(sql`
      alter default privileges in schema public
      grant select, insert, update, delete on tables to ${user}
    `);
    await db.execute(sql`
      alter default privileges in schema public
      grant usage, select on sequences to ${user}
    `);
  } finally {
    await close();
  }
}

if (require.main === module) {
  const adminConnectionString = process.env.DATABASE_ADMIN_URL;
  const appUser = process.env.APP_DB_USER;
  const appPassword = process.env.APP_DB_PASSWORD;
  const database = process.env.POSTGRES_DB;

  if (!adminConnectionString || !appUser || !appPassword || !database) {
    throw new Error(
      "DATABASE_ADMIN_URL, APP_DB_USER, APP_DB_PASSWORD e POSTGRES_DB são obrigatórios",
    );
  }

  bootstrapAppRole({ adminConnectionString, appUser, appPassword, database })
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`role de aplicação "${appUser}" pronta`);
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
