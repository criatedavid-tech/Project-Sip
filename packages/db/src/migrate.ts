import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client";

async function main(): Promise<void> {
  // Migração cria e altera tabelas, o que a role restrita da aplicação não pode
  // (e não deve poder) fazer.
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL não definida");
  }

  const { db, close } = createDatabase({ connectionString, maxConnections: 1 });
  const migrationsFolder = resolve(__dirname, "..", "migrations");

  try {
    await migrate(db, { migrationsFolder });
    // eslint-disable-next-line no-console
    console.log("migrações aplicadas");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
