import { drizzle } from 'npm:drizzle-orm/node-postgres';
import { Pool } from 'npm:pg';
import * as schema from '@/persistence/drizzle/entity/index.ts';
import { DATABASE_URL } from "@/config/env.ts";

// Instantiate Drizzle client with pg driver and schema.
const drizzleClient = drizzle({
  client: new Pool({
      connectionString: DATABASE_URL,
  }),
  schema
});

export type DrizzleClient = typeof drizzleClient;

export { drizzleClient };