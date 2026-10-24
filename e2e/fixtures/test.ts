import { expect, test as base } from "@playwright/test";
import { createDashboardStatusFixture } from "./dashboard-status";
import { StatusDashboardPage } from "../pages/status-dashboard-page";

type E2EFixtures = {
  dashboardStatus: ReturnType<typeof createDashboardStatusFixture>;
  statusDashboard: StatusDashboardPage;
};

export const test = base.extend<E2EFixtures>({
  dashboardStatus: async ({ page }, use) => {
    const dashboardStatus = createDashboardStatusFixture();
    await page.route(
      (url) => url.pathname === "/api/status",
      (route) => {
        const requestedServices = new URL(route.request().url()).searchParams.get("services");
        const selectedIds =
          requestedServices === null ? null : new Set(requestedServices.split(","));
        const payload = {
          ...dashboardStatus.payload,
          services: dashboardStatus.payload.services.filter(
            (service) => selectedIds === null || selectedIds.has(service.id),
          ),
          recentEvents: dashboardStatus.payload.recentEvents.filter(
            (event) => selectedIds === null || selectedIds.has(event.serviceId),
          ),
        };

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(payload),
        });
      },
    );
    await use(dashboardStatus);
  },
  statusDashboard: async ({ page }, use) => {
    await use(new StatusDashboardPage(page));
  },
});

export { expect };
