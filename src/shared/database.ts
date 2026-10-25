import { drizzle } from "drizzle-orm/d1";
import { incidentEvents, incidents, serviceComponents, serviceStatus } from "../../db/schema";

const schema = { incidentEvents, incidents, serviceComponents, serviceStatus };

export function createDatabase(database: D1Database) {
  return drizzle(database, { schema });
}

export type AppDatabase = ReturnType<typeof createDatabase>;
export type D1BatchQuery = Parameters<AppDatabase["batch"]>[0][number];
