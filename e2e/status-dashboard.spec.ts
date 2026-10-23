import { expect, test } from "@playwright/test";
import type { DashboardPayload } from "../src/domain";

const incidentTitle = "GitHub Actions jobs are delayed";
const incidentUrl = "https://www.githubstatus.com/incidents/actions-delay";
const checkedAt = new Date().toISOString();

const statusPayload: DashboardPayload = {
  generatedAt: checkedAt,
  freshnessWarningSeconds: 180,
  services: [
    {
      id: "slack",
      name: "Slack",
      statusPageUrl: "https://slack-status.com/",
      status: "operational",
      sourceStatus: "ok",
      summary: null,
      lastSuccessAt: checkedAt,
      hasFetchError: false,
      isStale: false,
      components: [],
      incidents: [],
    },
    {
      id: "github",
      name: "GitHub",
      statusPageUrl: "https://www.githubstatus.com/",
      status: "partial_outage",
      sourceStatus: "partial_outage",
      summary: "Actionsで一部のジョブ開始が遅延しています。",
      lastSuccessAt: checkedAt,
      hasFetchError: false,
      isStale: false,
      components: [
        {
          id: "actions",
          name: "Actions",
          status: "partial_outage",
          sourceStatus: "partial_outage",
          lastChangedAt: checkedAt,
        },
      ],
      incidents: [
        {
          id: "actions-delay",
          title: incidentTitle,
          body: "We are investigating delayed job starts for some GitHub Actions workflows.",
          kind: "incident",
          state: "investigating",
          sourceStatus: "investigating",
          sourceType: "incident",
          sourceImpact: "major",
          severityStatus: "partial_outage",
          componentIds: ["actions"],
          components: ["Actions"],
          officialCreatedAt: checkedAt,
          officialUpdatedAt: checkedAt,
          url: incidentUrl,
        },
      ],
    },
    {
      id: "notion",
      name: "Notion",
      statusPageUrl: "https://www.notion-status.com/",
      status: "operational",
      sourceStatus: "none",
      summary: null,
      lastSuccessAt: checkedAt,
      hasFetchError: false,
      isStale: false,
      components: [],
      incidents: [],
    },
  ],
  recentEvents: [
    {
      id: "actions-delay-updated",
      serviceId: "github",
      serviceName: "GitHub",
      incidentId: "actions-delay",
      title: incidentTitle,
      kind: "incident",
      eventKind: "updated",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      detectedAt: checkedAt,
      officialEventAt: checkedAt,
      url: incidentUrl,
    },
  ],
};

test("サービス名で障害サービスを検索し、障害詳細と最近の更新を確認できる", async ({ page }) => {
  await page.route("**/api/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusPayload),
    }),
  );

  await page.goto("/");

  const search = page.getByRole("searchbox", { name: "サービスを検索" });
  await expect(search).toBeVisible();
  await search.fill("GitHub");

  await expect(page.getByText("1サービス", { exact: true })).toBeVisible();
  const githubLink = page.getByRole("link", {
    name: "GitHubの公式ステータスページを新しいタブで開く",
  });
  await expect(githubLink).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Slackの公式ステータスページを新しいタブで開く" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Notionの公式ステータスページを新しいタブで開く" }),
  ).toHaveCount(0);

  const githubCard = page.getByRole("listitem").filter({ has: githubLink });
  await expect(githubCard.getByText("部分障害", { exact: true })).toHaveCount(2);
  await expect(githubCard.getByText("Actionsで一部のジョブ開始が遅延しています。")).toBeVisible();
  await expect(githubCard.getByRole("heading", { name: incidentTitle })).toBeVisible();
  await expect(
    githubCard.getByText(
      "We are investigating delayed job starts for some GitHub Actions workflows.",
    ),
  ).toBeVisible();
  await expect(githubCard.getByRole("link", { name: "公式情報を見る" })).toHaveAttribute(
    "href",
    incidentUrl,
  );

  const recentUpdates = page.getByRole("region", { name: "最近の更新" });
  const updateLink = recentUpdates.getByRole("link", { name: incidentTitle });
  await expect(updateLink).toBeVisible();
  const updateRow = recentUpdates.getByRole("listitem");
  await expect(updateRow).toContainText("GitHub");
  await expect(updateRow).toContainText("障害更新");
  await expect(updateLink).toHaveAttribute("href", incidentUrl);
});
