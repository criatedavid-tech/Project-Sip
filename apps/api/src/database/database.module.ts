import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@omni/db";
import { loadEnv } from "@omni/config";

export const DATABASE = Symbol("Database");

const databaseProvider = {
  provide: DATABASE,
  useFactory: (): Database => {
    const env = loadEnv();
    const { db, close } = createDatabase({ connectionString: env.DATABASE_URL });
    connections.push(close);
    return db;
  },
};

const connections: Array<() => Promise<void>> = [];

@Global()
@Module({
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(connections.map((close) => close()));
    connections.length = 0;
  }
}
