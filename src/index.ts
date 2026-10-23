import { collectAtScheduledTime } from "./cron/collect-status";
import { createStatusRoutes } from "./web/routes/api/status";

interface Env {
  DB: D1Database;
}

const app = createStatusRoutes();

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(collectAtScheduledTime(env.DB, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
