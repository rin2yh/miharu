import { createKvIncidentAlertStateStore } from "./cron/unknown-incident-alerts";
import { collectAtScheduledTime } from "./cron/collect-status";
import { createDiscordAlertSender } from "./cron/collection-alerts";
import { createKvCollectionAlertStateStore } from "./shared/collection-alert-state";
import { createStatusRoutes } from "./web/routes/api/status";

interface Env {
  DB: D1Database;
  COLLECTION_ALERT_STATE: KVNamespace;
  FRESHNESS_WARNING_SECONDS: string;
  DISCORD_WEBHOOK_URL?: string;
  ENVIRONMENT?: string;
}

const app = createStatusRoutes();

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    const sender = createDiscordAlertSender({
      webhookUrl: env.DISCORD_WEBHOOK_URL,
    });
    context.waitUntil(
      collectAtScheduledTime(env.DB, controller.scheduledTime, {
        alertState: createKvCollectionAlertStateStore(env.COLLECTION_ALERT_STATE),
        incidentAlertState: createKvIncidentAlertStateStore(env.COLLECTION_ALERT_STATE),
        sender,
        environment: env.ENVIRONMENT ?? "local",
      }),
    );
  },
} satisfies ExportedHandler<Env>;
