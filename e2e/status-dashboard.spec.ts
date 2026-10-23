import { expect, test } from "./fixtures/test";

test("サービス名で障害サービスを検索し、障害詳細と最近の更新を確認できる", async ({
  dashboardStatus,
  statusDashboard,
}) => {
  const { incidentTitle, incidentUrl } = dashboardStatus;
  await test.step("サービス名で検索する", async () => {
    await statusDashboard.goto();
    await statusDashboard.searchService("GitHub");

    await expect(statusDashboard.serviceCount(1)).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
    await expect(statusDashboard.serviceLink("Slack")).toHaveCount(0);
    await expect(statusDashboard.serviceLink("Notion")).toHaveCount(0);
  });

  await test.step("障害の詳細と公式リンクを確認する", async () => {
    const card = statusDashboard.serviceCard("GitHub");
    await expect(card.getByText("部分障害", { exact: true })).toHaveCount(2);
    await expect(card.getByText("Actionsで一部のジョブ開始が遅延しています。")).toBeVisible();
    await expect(card.getByRole("heading", { name: incidentTitle })).toBeVisible();
    await expect(
      card.getByText("We are investigating delayed job starts for some GitHub Actions workflows."),
    ).toBeVisible();
    await expect(card.getByRole("link", { name: "公式情報を見る" })).toHaveAttribute(
      "href",
      incidentUrl,
    );
  });

  await test.step("最近の更新に障害が掲載されていることを確認する", async () => {
    const recentUpdates = statusDashboard.recentUpdates();
    const updateLink = statusDashboard.recentIncidentLink(incidentTitle);
    await expect(updateLink).toBeVisible();
    const updateRow = recentUpdates.getByRole("listitem");
    await expect(updateRow).toContainText("GitHub");
    await expect(updateRow).toContainText("障害更新");
    await expect(updateLink).toHaveAttribute("href", incidentUrl);
  });
});
