import { collectAtScheduledTime } from "./cron/collect-status";
import { createDiscordAlertSender } from "./cron/collection-alerts";
import { createStatusRoutes } from "./web/routes/api/status";

interface Env {
  DB: D1Database;
  FRESHNESS_WARNING_SECONDS: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_ALERTS_ENABLED?: string;
  APP_ENV?: string;
}

const app = createStatusRoutes();

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    const isLocal = import.meta.env.DEV;
    const environment = isLocal ? "local" : (env.APP_ENV ?? "production");
    const sender = createDiscordAlertSender({
      webhookUrl: env.DISCORD_WEBHOOK_URL,
      enabled: !isLocal && env.DISCORD_ALERTS_ENABLED === "true",
      environment,
    });
    context.waitUntil(
      collectAtScheduledTime(env.DB, controller.scheduledTime, { sender, environment }),
    );
  },
} satisfies ExportedHandler<Env>;
