import { SERVICES } from "../shared/config/services";
import { createD1Store } from "../shared/store";
import { collectAll } from "./collector";

export async function collectAtScheduledTime(
  database: D1Database,
  scheduledTime: number,
): Promise<void> {
  const store = createD1Store(database);
  await collectAll(SERVICES, new Date(scheduledTime).toISOString(), store);

  if (new Date(scheduledTime).getUTCMinutes() % 15 === 0) {
    await store.pruneHistory(new Date(scheduledTime));
  }
}
