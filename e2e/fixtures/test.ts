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
    await page.route("**/api/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dashboardStatus.payload),
      }),
    );
    await use(dashboardStatus);
  },
  statusDashboard: async ({ page }, use) => {
    await use(new StatusDashboardPage(page));
  },
});

export { expect };
