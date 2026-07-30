import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CreateDatabaseOptions {
  connectionString: string;
  maxConnections?: number;
}

export function createDatabase(options: CreateDatabaseOptions): {
  db: Database;
  close: () => Promise<void>;
} {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    onnotice: () => {},
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

/**
 * Executa o callback dentro de uma transação com o tenant fixado na sessão.
 * As políticas de RLS leem app.current_org_id, então toda query feita aqui
 * dentro só enxerga dados da organização informada — o isolamento não depende
 * de o chamador lembrar de filtrar por organization_id.
 *
 * SET LOCAL garante que o valor morre junto com a transação, evitando
 * vazamento de tenant entre requisições que reusam a mesma conexão do pool.
 */
export async function withOrganization<T>(
  db: Database,
  organizationId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}
